import { segmentation_categories, segmentation_category_colors } from "../../helpers/constants";
import { organDescriptions } from "../../helpers/organInfo";

const prettyName = (name: string) => name.replaceAll("_", " ");
const organs = segmentation_categories as readonly string[];

type Props = {
	selectedOrganId: number | null;
};

export default function OrganInfo({ selectedOrganId }: Props) {
	const organ = selectedOrganId && selectedOrganId >= 1 ? organs[selectedOrganId - 1] : null;
	const color = selectedOrganId ? segmentation_category_colors[selectedOrganId] : undefined;
	const swatch = color ? `rgb(${color[0]}, ${color[1]}, ${color[2]})` : "#777";
	const description = organ
		? organDescriptions[organ] ?? "No plain-language description yet for this structure."
		: "";

	return (
		<div className="w-full flex flex-col gap-2 border-2 rounded-sm bg-gray-900 shadow-md">
			<div className="bg-gray-600 w-full h-8 flex items-center justify-center text-center rounded-t-sm text-white">
				Learn
			</div>
			<div className="pb-2 pl-4 pr-4 flex flex-col gap-2">
				{organ ? (
					<>
						<div className="flex items-center gap-2">
							<span
								aria-hidden="true"
								style={{ width: 14, height: 14, borderRadius: 4, background: swatch, display: "inline-block", flexShrink: 0 }}
							/>
							<span className="text-white capitalize">{prettyName(organ)}</span>
						</div>
						<p className="text-gray-200 text-sm leading-snug">{description}</p>
					</>
				) : (
					<p className="text-gray-300 text-sm leading-snug">
						Select a structure in the scan to learn what it is.
					</p>
				)}
			</div>
		</div>
	);
}
