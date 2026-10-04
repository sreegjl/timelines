// Validation returns stable codes so pure helpers stay free of translation state.
// Every key is spelled out here so i18next-parser can see it.
export function validationMessage(code, t) {
  switch (code) {
    case "scaleBothRequired": return t("common:validation.scaleBothRequired", "Both start and end required");
    case "scaleInvalidStart": return t("common:validation.scaleInvalidStart", "Invalid start date");
    case "scaleInvalidEnd": return t("common:validation.scaleInvalidEnd", "Invalid end date");
    case "scaleMustDiffer": return t("common:validation.scaleMustDiffer", "Start and end must differ");
    case "scaleOutOfRange": return t("common:validation.scaleOutOfRange", "Scale must be 0–2");
    case "eventDateInvalid": return t("common:validation.eventDateInvalid", "Event date must be a number or MM/DD/YYYY.");
    case "startEndInvalid": return t("common:validation.startEndInvalid", "Start and end must be numbers or MM/DD/YYYY.");
    case "eventOutOfBounds": return t("common:validation.eventOutOfBounds", "Event date must be within the timeline bounds.");
    case "startAfterEnd": return t("common:validation.startAfterEnd", "Start must be before End.");
    case "spanOutOfRange": return t("common:validation.spanOutOfRange", "Span/Era must overlap with the timeline range.");
    case "extendFromMismatch": return t("common:validation.extendFromMismatch", "Extend From only works when the selected span ends exactly at this span's start.");
    default: return code;
  }
}
