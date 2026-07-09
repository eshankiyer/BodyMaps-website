import React, { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './UploadPage.css';
import { API_BASE } from '../helpers/constants';
import Header from '../components/Header';

const CtPreview = lazy(() => import('../components/CtPreview/CtPreview'));

const CHUNK_SIZE = 256 * 1024;
const NIFTI_EXTS = ['.nii', '.nii.gz'];
const DICOM_EXTS = ['.dcm', '.dicom'];

type JobStatus = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';

type PendingItem = {
  id: string;
  displayName: string;
  files: File[];
  isDicom: boolean;
};

type UploadJob = {
  id: string;
  displayName: string;
  files: File[];
  isDicom: boolean;
  sessionId: string | null;
  status: JobStatus;
  uploadProgress: number;
  inferenceProgress: number;
  model: string;
  timestamp: number;
  error?: string;
};

const parseApiResponse = async (res: Response): Promise<any> => {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  const text = await res.text();
  throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, ' ').trim()}`);
};

const UploadPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jobQueueRef = useRef<UploadJob[]>([]);
  const isProcessingRef = useRef(false);

  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedPreprocessing, setSelectedPreprocessing] = useState('');
  const [selectedPostprocessing, setSelectedPostprocessing] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  /* ── File selection ── */
  const addFiles = (files: File[]) => {
    const niftiFiles = files.filter(f =>
      NIFTI_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
    );
    const dicomFiles = files.filter(f =>
      DICOM_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
    );

    const newItems: PendingItem[] = [];

    niftiFiles.forEach(f => newItems.push({
      id: crypto.randomUUID(),
      displayName: f.name,
      files: [f],
      isDicom: false,
    }));

    if (dicomFiles.length > 0) {
      newItems.push({
        id: crypto.randomUUID(),
        displayName: `DICOM Series (${dicomFiles.length} slices)`,
        files: dicomFiles,
        isDicom: true,
      });
    }

    if (newItems.length === 0) {
      alert('Please select .nii, .nii.gz, or .dcm files only.');
      return;
    }
    setPendingItems(prev => [...prev, ...newItems]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const removePendingItem = (id: string) => {
    setPendingItems(prev => prev.filter(item => item.id !== id));
    if (previewItemId === id) setPreviewItemId(null);
  };

  const togglePreview = (id: string) =>
    setPreviewItemId(prev => (prev === id ? null : id));

  /* ── Job state helpers ── */
  const patchJob = (id: string, patch: Partial<UploadJob>) =>
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));

  /* ── Polling ── */
  const pollUntilDone = (sessionId: string, jobId: string): Promise<void> =>
    new Promise(resolve => {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/inference-status/${sessionId}`);
          const data = await parseApiResponse(res);
          const status = (data.status || '').toLowerCase();
          if (status === 'completed') {
            clearInterval(interval);
            patchJob(jobId, { status: 'completed', inferenceProgress: 100 });
            resolve();
          } else if (status === 'failed') {
            clearInterval(interval);
            patchJob(jobId, { status: 'failed', error: data.error || 'Inference failed' });
            resolve();
          } else {
            setJobs(prev => prev.map(j =>
              j.id === jobId
                ? { ...j, inferenceProgress: Math.min(95, j.inferenceProgress + 7) }
                : j
            ));
          }
        } catch { /* keep polling */ }
      }, 2500);
    });

  /* ── Process NIfTI job ── */
  const processNiftiJob = async (job: UploadJob): Promise<void> => {
    const sid = crypto.randomUUID();
    patchJob(job.id, { sessionId: sid, status: 'uploading', uploadProgress: 0 });
    const file = job.files[0];
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
        const fd = new FormData();
        fd.append('session_id', sid);
        fd.append('chunk_index', i.toString());
        fd.append('total_chunks', totalChunks.toString());
        fd.append('file', chunk);
        const res = await fetch(`${API_BASE}/api/upload-inference-chunk`, { method: 'POST', body: fd });
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || 'Chunk upload failed');
        patchJob(job.id, { uploadProgress: Math.round(((i + 1) / totalChunks) * 100) });
      }

      const finalizeRes = await fetch(`${API_BASE}/api/finalize-upload`, {
        method: 'POST',
        body: new URLSearchParams({
          session_id: sid,
          total_chunks: totalChunks.toString(),
          output_filename: file.name,
        }),
      });
      const finalizeData = await parseApiResponse(finalizeRes);
      if (!finalizeRes.ok) throw new Error(finalizeData.error || 'Finalize failed');

      patchJob(job.id, { status: 'processing', inferenceProgress: 5 });

      const inferFd = new FormData();
      inferFd.append('session_id', sid);
      inferFd.append('model_name', job.model);
      inferFd.append('uploaded_filename', finalizeData.uploaded_filename || file.name);
      const inferRes = await fetch(`${API_BASE}/api/run-epai-inference`, { method: 'POST', body: inferFd });
      const inferData = await parseApiResponse(inferRes);
      if (!inferRes.ok) throw new Error(inferData.error || 'Failed to start inference');

      const actualSid = inferData.session_id || sid;
      if (actualSid !== sid) patchJob(job.id, { sessionId: actualSid });
      await pollUntilDone(actualSid, job.id);
    } catch (err) {
      patchJob(job.id, { status: 'failed', error: (err as Error).message });
    }
  };

  /* ── Process DICOM job ── */
  const processDicomJob = async (job: UploadJob): Promise<void> => {
    const sid = crypto.randomUUID();
    patchJob(job.id, { sessionId: sid, status: 'uploading', uploadProgress: 0 });
    try {
      const total = job.files.length;
      for (let i = 0; i < total; i++) {
        const fd = new FormData();
        fd.append('session_id', sid);
        fd.append('file', job.files[i]);
        const res = await fetch(`${API_BASE}/api/upload-dicom-slice`, { method: 'POST', body: fd });
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || 'DICOM slice upload failed');
        patchJob(job.id, { uploadProgress: Math.round(((i + 1) / total) * 100) });
      }

      const finalizeRes = await fetch(`${API_BASE}/api/finalize-dicom`, {
        method: 'POST',
        body: new URLSearchParams({ session_id: sid }),
      });
      const finalizeData = await parseApiResponse(finalizeRes);
      if (!finalizeRes.ok) throw new Error(finalizeData.error || 'DICOM conversion failed');

      patchJob(job.id, { status: 'processing', inferenceProgress: 5 });

      const inferFd = new FormData();
      inferFd.append('session_id', sid);
      inferFd.append('model_name', job.model);
      inferFd.append('uploaded_filename', finalizeData.uploaded_filename || 'ct.nii.gz');
      const inferRes = await fetch(`${API_BASE}/api/run-epai-inference`, { method: 'POST', body: inferFd });
      const inferData = await parseApiResponse(inferRes);
      if (!inferRes.ok) throw new Error(inferData.error || 'Failed to start inference');

      const actualSid = inferData.session_id || sid;
      if (actualSid !== sid) patchJob(job.id, { sessionId: actualSid });
      await pollUntilDone(actualSid, job.id);
    } catch (err) {
      patchJob(job.id, { status: 'failed', error: (err as Error).message });
    }
  };

  /* ── Sequential queue runner ── */
  const drainQueue = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    while (jobQueueRef.current.length > 0) {
      const next = jobQueueRef.current.shift()!;
      if (next.isDicom) {
        await processDicomJob(next);
      } else {
        await processNiftiJob(next);
      }
    }
    isProcessingRef.current = false;
  };

  /* ── Run batch ── */
  const handleRun = () => {
    if (!selectedModel) { alert('Please select a model first.'); return; }
    if (pendingItems.length === 0) { alert('Please select at least one file.'); return; }

    const newJobs: UploadJob[] = pendingItems.map(item => ({
      id: crypto.randomUUID(),
      displayName: item.displayName,
      files: item.files,
      isDicom: item.isDicom,
      sessionId: null,
      status: 'queued' as JobStatus,
      uploadProgress: 0,
      inferenceProgress: 0,
      model: selectedModel,
      timestamp: Date.now(),
    }));

    setJobs(prev => [...prev, ...newJobs]);
    jobQueueRef.current.push(...newJobs);
    setPendingItems([]);
    setPreviewItemId(null);
    drainQueue();
  };

  /* ── Download ── */
  const downloadJob = async (job: UploadJob) => {
    if (!job.sessionId) return;
    try {
      const res = await fetch(`${API_BASE}/api/get_result/${job.sessionId}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `result_${job.sessionId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed: ' + (err as Error).message);
    }
  };

  const handleDownloadAll = () => {
    doneJobs.filter(j => j.status === 'completed').forEach(job => downloadJob(job));
  };

  /* ── Derived state ── */
  const activeJobs = jobs.filter(j =>
    j.status === 'uploading' || j.status === 'processing'
  );
  const queuedCount = jobs.filter(j => j.status === 'queued').length;
  const activeCount = activeJobs.length + queuedCount;
  const doneJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed');
  const previewItem = pendingItems.find(i => i.id === previewItemId) ?? null;

  /* ── Render ── */
  return (
    <div className="upload-page-wrapper">
      <div className="ambient-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
      </div>

      <Header />

      <div className="upload-main">
        <div className="upload-card">
          <div className="upload-card-label">Upload</div>

          {/* Drop zone */}
          <div
            className={`dropzone${isDragOver ? ' drag-over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".nii,.gz,.dcm,.dicom"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div className="dropzone-text">Click or drag to upload</div>
            <div className="dropzone-sub">.nii · .nii.gz · .dcm · hold ⌘/Ctrl to select multiple</div>
          </div>

          {/* Pending file chips */}
          {pendingItems.length > 0 && (
            <div className="file-chips">
              {pendingItems.map(item => (
                <div key={item.id} className={`file-chip${previewItemId === item.id ? ' file-chip--active' : ''}`}>
                  <span className="file-chip-name">{item.displayName}</span>
                  {!item.isDicom && (
                    <button
                      className="file-chip-preview"
                      onClick={e => { e.stopPropagation(); togglePreview(item.id); }}
                      title="Preview CT scan"
                    >
                      {previewItemId === item.id ? 'Hide' : 'Preview'}
                    </button>
                  )}
                  <button
                    className="file-chip-remove"
                    onClick={e => { e.stopPropagation(); removePendingItem(item.id); }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* CT Preview panel */}
          {previewItem && (
            <div className="pending-preview-panel">
              <div className="ct-preview-label">Preview · {previewItem.displayName}</div>
              <Suspense fallback={<div className="ct-preview ct-preview--msg">Loading preview…</div>}>
                <CtPreview file={previewItem.files[0]} />
              </Suspense>
            </div>
          )}

          {/* Pipeline row */}
          <div className="pipeline-row">
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <div className="pipeline-badge">1</div>
                <span className="pipeline-label">Preprocessing</span>
                <span className="pipeline-optional">optional</span>
              </div>
              <select
                className={`pipeline-select${selectedPreprocessing ? ' has-value' : ''}`}
                value={selectedPreprocessing}
                onChange={e => setSelectedPreprocessing(e.target.value)}
              >
                <option value="">None (skip)</option>
                <option value="OpenVAE">OpenVAE</option>
              </select>
            </div>

            <div className="pipeline-arrow">→</div>

            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <div className="pipeline-badge">2</div>
                <span className="pipeline-label">Model</span>
              </div>
              <select
                className={`pipeline-select${selectedModel ? ' has-value' : ''}`}
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
              >
                <option value="" disabled>Select a model</option>
                <option value="ePAI">ePAI</option>
                <option value="SuPreM">SuPreM</option>
                <option value="MedFormer">MedFormer</option>
                <option value="R-Super">R-Super</option>
                <option value="Atlas-Net">Atlas-Net</option>
              </select>
            </div>

            <div className="pipeline-arrow">→</div>

            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <div className="pipeline-badge">3</div>
                <span className="pipeline-label">Postprocessing</span>
                <span className="pipeline-optional">optional</span>
              </div>
              <select
                className={`pipeline-select${selectedPostprocessing ? ' has-value' : ''}`}
                value={selectedPostprocessing}
                onChange={e => setSelectedPostprocessing(e.target.value)}
              >
                <option value="">None (skip)</option>
                <option value="ShapeKit">ShapeKit</option>
              </select>
            </div>

            <button
              className="run-btn"
              onClick={handleRun}
              disabled={!selectedModel || pendingItems.length === 0}
            >
              Run
            </button>
          </div>
        </div>

        {/* Queue status */}
        {jobs.length > 0 && (
          <div style={{ marginTop: '24px' }}>

            {/* Active job progress */}
            {activeJobs.map(job => (
              <div key={job.id} className="upload-active-job">
                <div className="upload-active-job-header">
                  <span className="upload-processing-dot" />
                  <span className="upload-active-job-name">{job.displayName}</span>
                  <span className="upload-active-job-status">
                    {job.status === 'uploading' ? 'Uploading' : 'Running inference'}
                  </span>
                </div>

                {job.status === 'uploading' && (
                  <div className="upload-progress-row">
                    <span className="upload-progress-label">Upload</span>
                    <div className="upload-progress-track">
                      <div className="upload-progress-fill upload-progress-fill--upload" style={{ width: `${job.uploadProgress}%` }} />
                    </div>
                    <span className="upload-progress-pct">{job.uploadProgress}%</span>
                  </div>
                )}

                {job.status === 'processing' && (
                  <>
                    <div className="upload-progress-row">
                      <span className="upload-progress-label">Upload</span>
                      <div className="upload-progress-track">
                        <div className="upload-progress-fill upload-progress-fill--upload" style={{ width: '100%' }} />
                      </div>
                      <span className="upload-progress-pct">100%</span>
                    </div>
                    <div className="upload-progress-row">
                      <span className="upload-progress-label">Inference</span>
                      <div className="upload-progress-track">
                        <div className="upload-progress-fill upload-progress-fill--inference" style={{ width: `${job.inferenceProgress}%` }} />
                      </div>
                      <span className="upload-progress-pct">{job.inferenceProgress}%</span>
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Queued counter */}
            {activeCount > 0 && (
              <div className="upload-processing-counter" style={{ marginTop: activeJobs.length > 0 ? '12px' : '0' }}>
                <span className="upload-processing-dot" />
                {activeCount} scan{activeCount !== 1 ? 's' : ''} left in queue
              </div>
            )}

            {/* Completed + failed scans */}
            {doneJobs.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', marginTop: activeCount > 0 ? '20px' : '0' }}>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '11px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#8f8f8f' }}>
                    Results
                  </div>
                  {doneJobs.some(j => j.status === 'completed') && (
                    <button className="upload-dl-all-btn" onClick={handleDownloadAll}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download All
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {doneJobs.map(job => {
                    const isFailed = job.status === 'failed';
                    return (
                      <div
                        key={job.id}
                        className={`upload-completed-row${isFailed ? ' upload-completed-row--failed' : ''}`}
                        onClick={() => !isFailed && job.sessionId && navigate(`/session/${job.sessionId}`)}
                      >
                        <div className="upload-completed-icon">
                          {isFailed ? (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="15" y1="9" x2="9" y2="15" />
                              <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                          ) : (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6a6a6a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="16" y1="13" x2="8" y2="13" />
                              <line x1="16" y1="17" x2="8" y2="17" />
                            </svg>
                          )}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: isFailed ? '#ef4444' : '#111111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {job.displayName}
                          </div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: isFailed ? '#f87171' : '#6a6a6a', marginTop: 2 }}>
                            {isFailed
                              ? (job.error || 'Unknown error')
                              : `${job.model} · click to view`}
                          </div>
                        </div>

                        {!isFailed && (
                          <>
                            <button
                              className="result-btn"
                              onClick={e => { e.stopPropagation(); job.sessionId && navigate(`/session/${job.sessionId}`); }}
                            >
                              View
                            </button>
                            <button
                              className="result-btn"
                              onClick={e => { e.stopPropagation(); downloadJob(job); }}
                            >
                              Download
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadPage;
