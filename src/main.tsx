import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import ChessTrainer from "./ChessTrainer";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChessTrainer />
  </StrictMode>
);
