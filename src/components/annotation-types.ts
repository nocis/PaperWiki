import type { ScaledPosition } from "react-pdf-highlighter";

export interface PaperComment {
  id: string;
  paperSlug: string;
  text: string;
  comment: string;
  createdAt: string;
  position: ScaledPosition;
}
