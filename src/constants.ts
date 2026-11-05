/** Scale factor used when rendering thumbnail previews of PDF pages */
export const THUMBNAIL_SCALE = 0.5;

/** Pixel budget per thumbnail canvas; oversized pages render at a smaller scale */
export const THUMBNAIL_MAX_PIXELS = 1_000_000;

/** IntersectionObserver rootMargin for pre-loading thumbnails before they enter view */
export const THUMBNAIL_INTERSECTION_MARGIN = "200px";

/** Degrees to rotate a page per rotation action */
export const ROTATION_STEP = 90;

/** Milliseconds before a toast notification auto-dismisses */
export const TOAST_DISMISS_TIMEOUT_MS = 3000;

/** Milliseconds before an error toast auto-dismisses (WCAG 2.2.1 needs more time to read) */
export const TOAST_ERROR_DISMISS_TIMEOUT_MS = 8000;

/** Default file name for the merged/reordered PDF output */
export const OUTPUT_FILENAME = "interleaf-output.pdf";

/** Default file name for PDFs created from image files */
export const IMAGES_TO_PDF_FILENAME = "interleaf-images.pdf";

/** Title shown in the password prompt modal for encrypted PDFs */
export const PASSWORD_MODAL_TITLE = "Password required";

export const MIN_TEXT_SIZE = 6;
export const MAX_TEXT_SIZE = 144;
