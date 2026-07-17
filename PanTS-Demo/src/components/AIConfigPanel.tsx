import {
  IconCloudUpload, IconPlayerPlay, IconAtom, IconBox,
  IconTargetArrow, IconTopologyStar3, IconMicroscope, IconWand,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../helpers/constants";

const CHUNK_SIZE = 256 * 1024;
const TEAL = "rgb(45,212,191)";

type Model = "ePAI" | "SuPreM" | "MedFormer" | "R-Super" | "OpenVAE" | "Atlas-Net" | "";
type Precision = "FP32" | "FP16" | "INT8";

const MODELS: { id: Exclude<Model, "">; Icon: any; desc: string; recommended?: boolean }[] = [
  { id: "SuPreM", Icon: IconAtom, desc: "Universal — 25 organs", recommended: true },
  { id: "ePAI", Icon: IconBox, desc: "General nnU-Net 3D" },
  { id: "Atlas-Net", Icon: IconTargetArrow, desc: "Pancreas + 26 structures" },
  { id: "MedFormer", Icon: IconTopologyStar3, desc: "Transformer segmentation" },
  { id: "R-Super", Icon: IconMicroscope, desc: "Pancreatic tumor detection" },
  { id: "OpenVAE", Icon: IconWand, desc: "Generative (MAISI)" },
];

const PRECISIONS: { id: Precision; note: string; recommended?: boolean }[] = [
  { id: "FP32", note: "Full-precision baseline." },
  { id: "FP16", note: "Half precision, recommended for most scans.", recommended: true },
  { id: "INT8", note: "Eight-bit; needs a one-time CT calibration." },
];

const parseApiResponse = async (res: Response): Promise<any> => {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  const text = await res.text();
  throw new Error(`Expected JSON but got ${contentType} (HTTP ${res.status}). Body: ${text.slice(0, 200).replace(/\s+/g, " ").trim()}`);
};

export default function AIConfigPanel() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedModel, setSelectedModel] = useState<Model>("SuPreM");
  const [precision, setPrecision] = useState<Precision>("FP16");
  const [phase, setPhase] = useState<"idle" | "uploading" | "inferencing" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [dropHover, setDropHover] = useState(false);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPoll(), []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDropHover(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".nii") || file.name.endsWith(".nii.gz"))) setSelectedFile(file);
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) setSelectedFile(file);
  };

  const startPolling = (sid: string, model: Model) => {
    stopPoll(); setPhase("inferencing"); setProgress(5);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/inference-status/${sid}`);
        const data = await parseApiResponse(res);
        const status = (data.status || "").toLowerCase();
        if (status === "completed") {
          setProgress(100); setPhase("done"); stopPoll();
          setTimeout(() => navigate(model === "OpenVAE" ? `/reconstruction/${sid}` : `/session/${sid}`), 600);
        } else if (status === "failed") {
          setPhase("idle"); setStatusText(`Inference failed: ${data.error || "unknown error"}`); stopPoll();
        } else { setProgress((p) => Math.min(95, p + 7)); }
      } catch { setProgress((p) => Math.min(95, p + 3)); }
    }, 2500);
  };

  const handleRun = async () => {
    if (!selectedFile || !selectedModel) return;
    const sid = crypto.randomUUID();
    const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
    setPhase("uploading"); setProgress(0); setStatusText(`Uploading ${selectedFile.name}…`);
    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunk = selectedFile.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, selectedFile.size));
        const fd = new FormData();
        fd.append("session_id", sid); fd.append("chunk_index", i.toString());
        fd.append("total_chunks", totalChunks.toString()); fd.append("file", chunk);
        const res = await fetch(`${API_BASE}/api/upload-inference-chunk`, { method: "POST", body: fd });
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || "Chunk upload failed");
        setProgress(Math.round(((i + 1) / totalChunks) * 100));
      }
      const finalFd = new URLSearchParams({ session_id: sid, total_chunks: totalChunks.toString(), output_filename: selectedFile.name });
      const finalRes = await fetch(`${API_BASE}/api/finalize-upload`, { method: "POST", body: finalFd });
      const finalData = await parseApiResponse(finalRes);
      if (!finalRes.ok) throw new Error(finalData.error);
      setStatusText(`Running ${selectedModel}…`);
      const inferFd = new FormData();
      inferFd.append("session_id", sid);
      inferFd.append("model_name", selectedModel);
      inferFd.append("precision", precision);
      inferFd.append("uploaded_filename", finalData.uploaded_filename || selectedFile.name);
      const inferRes = await fetch(`${API_BASE}/api/run-epai-inference`, { method: "POST", body: inferFd });
      const inferData = await parseApiResponse(inferRes);
      if (!inferRes.ok) throw new Error(inferData.error || "Failed to start inference");
      startPolling(sid, selectedModel);
    } catch (err) {
      setPhase("idle"); setStatusText("Error: " + (err as Error).message);
    }
  };

  const isRunning = phase === "uploading" || phase === "inferencing";
  const canRun = !!selectedFile && !!selectedModel && !isRunning;
  const phaseLabel = phase === "uploading" ? `Uploading… ${progress}%`
    : phase === "inferencing" ? `Running ${selectedModel}… ${progress}%`
    : phase === "done" ? "Done! Opening viewer…" : "";

  const cardStyle = (sel: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 10, cursor: isRunning ? "default" : "pointer",
    padding: sel ? "11px 13px" : "12px 14px", borderRadius: 12,
    border: sel ? `2px solid ${TEAL}` : "1px solid rgba(255,255,255,0.1)",
    background: sel ? "rgba(45,212,191,0.08)" : "rgba(255,255,255,0.03)",
  });

  return (
    <div className="flex flex-col gap-4 w-full" style={{ color: "rgba(255,255,255,0.85)" }}>
      <div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>1 · Model</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          {MODELS.map(({ id, Icon, desc, recommended }) => (
            <div key={id} style={cardStyle(selectedModel === id)} onClick={() => !isRunning && setSelectedModel(id)}>
              <Icon size={20} style={{ color: TEAL, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {id}
                  {recommended && <span style={{ fontSize: 10, color: TEAL, background: "rgba(45,212,191,0.12)", padding: "2px 7px", borderRadius: 999, marginLeft: 6 }}>Recommended</span>}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>2 · Precision</div>
        <div style={{ display: "flex", gap: 8 }}>
          {PRECISIONS.map(({ id, recommended }) => {
            const sel = precision === id;
            return (
              <button key={id} onClick={() => !isRunning && setPrecision(id)} style={{
                padding: sel ? "7px 15px" : "8px 16px", borderRadius: 8, fontSize: 13,
                cursor: isRunning ? "default" : "pointer",
                border: sel ? `2px solid ${TEAL}` : "1px solid rgba(255,255,255,0.12)",
                background: sel ? "rgba(45,212,191,0.1)" : "transparent",
                color: sel ? TEAL : "rgba(255,255,255,0.6)",
              }}>{id}{recommended ? " ★" : ""}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 8 }}>
          {PRECISIONS.find((p) => p.id === precision)?.note}
        </div>
      </div>

      <div className="w-full rounded-xl flex flex-col items-center gap-2 cursor-pointer transition-all duration-200"
        style={{ padding: "26px 20px", border: `1.5px dashed ${dropHover || selectedFile ? "rgba(45,212,191,0.55)" : "rgba(255,255,255,0.12)"}`, background: dropHover || selectedFile ? "rgba(45,212,191,0.05)" : "rgba(255,255,255,0.02)" }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDropHover(true); }}
        onDragLeave={() => setDropHover(false)} onDrop={handleDrop}>
        <IconCloudUpload size={32} style={{ color: selectedFile ? TEAL : "rgba(255,255,255,0.3)" }} />
        {selectedFile
          ? <span className="font-medium text-center break-all" style={{ fontSize: 12, color: TEAL }}>{selectedFile.name}</span>
          : <><span className="font-medium" style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>Drop a CT scan or browse</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)" }}>.nii or .nii.gz</span></>}
        <input ref={fileInputRef} type="file" accept=".nii,.gz" className="hidden" onChange={handleFileChange} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          {selectedModel || "No model"} · {precision}{selectedFile ? " · ready" : " · add a scan"}
        </div>
        <button className="rounded-lg text-sm font-semibold transition-all duration-200"
          style={{ padding: "9px 22px", display: "flex", alignItems: "center", gap: 6,
            background: canRun ? "linear-gradient(135deg, rgba(45,212,191,0.9), rgba(34,211,238,0.85))" : "rgba(255,255,255,0.07)",
            color: canRun ? "#050c1a" : "rgba(255,255,255,0.22)", cursor: canRun ? "pointer" : "not-allowed", border: "none" }}
          onClick={handleRun} disabled={!canRun}>
          <IconPlayerPlay size={15} /> Run segmentation
        </button>
      </div>

      {isRunning || phase === "done" ? (
        <div className="flex flex-col gap-1.5">
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textAlign: "center" }}>{phaseLabel}</div>
          <div className="w-full rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.07)" }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: "linear-gradient(90deg, rgb(45,212,191), rgb(34,211,238))" }} />
          </div>
        </div>
      ) : statusText ? (
        <p className="text-center" style={{ fontSize: 11, color: "rgba(239,68,68,0.85)" }}>{statusText}</p>
      ) : null}
    </div>
  );
}
