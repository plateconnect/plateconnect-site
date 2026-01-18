// Grade color utilities for elementary, middle, and high school

export function getGradeColor(grade: number): string {
  if (grade <= 5) {
    return "#22c55e"; // Green - Elementary
  } else if (grade <= 8) {
    return "#f97316"; // Orange - Middle school
  } else {
    return "#3b82f6"; // Blue - High school
  }
}

export function getGradeLabel(grade: number): string {
  if (grade <= 5) {
    return "Elementary";
  } else if (grade <= 8) {
    return "Middle";
  } else {
    return "High";
  }
}

export function getGradeBgClass(grade: number): string {
  if (grade <= 5) {
    return "bg-green-500"; // Elementary
  } else if (grade <= 8) {
    return "bg-orange-500"; // Middle school
  } else {
    return "bg-blue-500"; // High school
  }
}
