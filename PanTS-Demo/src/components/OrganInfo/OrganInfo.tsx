import { useState } from "react";
import { segmentation_categories, segmentation_category_colors } from "../../helpers/constants";
import { organDescriptions } from "../../helpers/organInfo";

const prettyName = (name: string) => name.replaceAll("_", " ");

const organs = segmentation_categories as readonly string[];

export default function OrganInfo() {
	const [organ, setOrgan] = useState<string>("liver");

	const idx = organs.indexOf(organ);
	const color = idx >= 0 ? segmentation_category_colors[idx + 1] : undefined;
	const swatch = color ? `rgb(${color[0]}, ${color[1]}, ${color[2]})` : "#777";
	const description = organDescriptions[organ] ?? "No plain-language description yet for this structure.";

	return (
		<div className="w-full flex flex-col gap-2 border-2 rounded-sm bg-gray-900 shadow-md">
			<div className="bg-gray-600 w-full h-8 flex items-center justify-center text-center rounded-t-sm text-white">
				Learn
			</div>
			<div className="pb-2 pl-4 pr-4 flex flex-col gap-2">
				<label className="text-white text-sm" htmlFor="organ-learn-select">
					Pick a structure
				</label>
				<select
					id="organ-learn-select"
					aria-label="Pick a structure to learn about"
					className="border text-white rounded-md p-1 w-full bg-gray-800"
					value={organ}
					onChange={(e) => setOrgan(e.target.value)}
				>
					{organs.map((o) => (
						<option key={o} value={o}>
							{prettyName(o)}
						</option>
					))}
				</select>
				<div className="flex items-center gap-2">
					<span
						aria-hidden="true"
						style={{ width: 14, height: 14, borderRadius: 4, background: swatch, display: "inline-block", flexShrink: 0 }}
					/>
					<span className="text-white capitalize">{prettyName(organ)}</span>
				</div>
				<p className="text-gray-200 text-sm leading-snug">{description}</p>
			</div>
		</div>
	);
}
