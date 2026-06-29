const pretty = (s: string) => s.replaceAll("_", " ");

type Props = {
	active: boolean;
	targetName: string | null;
	score: number;
	streak: number;
	result: { correct: boolean; text: string } | null;
	onStart: () => void;
	onStop: () => void;
};

export default function Challenge({ active, targetName, score, streak, result, onStart, onStop }: Props) {
	return (
		<div className="w-full flex flex-col gap-2 border-2 rounded-sm bg-gray-900 shadow-md">
			<div className="bg-gray-600 w-full h-8 flex items-center justify-center text-center rounded-t-sm text-white">
				Challenge
			</div>
			<div className="pb-2 pl-4 pr-4 flex flex-col gap-2">
				{active ? (
					<>
						<div className="text-gray-300 text-sm">Find this structure in the scan:</div>
						<div className="text-white text-lg font-medium capitalize">{targetName ? pretty(targetName) : "…"}</div>
						<div className="flex gap-4 text-xs text-gray-300">
							<span>Score: {score}</span>
							<span>Streak: {streak}</span>
						</div>
						{result && (
							<div className={result.correct ? "text-green-400 text-sm" : "text-red-400 text-sm"}>{result.text}</div>
						)}
						<button
							type="button"
							className="text-white relative !p-1 text-2xs !bg-gray-700 hover:!border-white"
							onClick={onStop}
						>
							Stop
						</button>
					</>
				) : (
					<>
						<p className="text-gray-300 text-sm leading-snug">
							Test yourself: the app names a structure and you click it on the actual CT. You can't score without reading the scan.
						</p>
						<button
							type="button"
							className="text-white relative !p-1 text-2xs !bg-gray-700 hover:!border-white"
							onClick={onStart}
						>
							Start challenge
						</button>
					</>
				)}
			</div>
		</div>
	);
}
