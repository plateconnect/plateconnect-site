import { getGradeColor } from "@/lib/gradeUtils";

interface GradeBadgeProps {
  grade: number;
}

export default function GradeBadge({ grade }: GradeBadgeProps) {
  const color = getGradeColor(grade);

  return (
    <span
      className="px-3 py-1 rounded-full text-white text-xs font-medium"
      style={{ backgroundColor: color }}
    >
      Grade {grade}
    </span>
  );
}
