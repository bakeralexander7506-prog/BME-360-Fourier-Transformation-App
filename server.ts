import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "25mb" }));

  // API: Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "BME 360 Fourier Lab" });
  });

  // API: Server-side Gemini AI Teaching Assistant for BME 360
  app.post("/api/gemini/explain", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "GEMINI_API_KEY is not configured in the environment.",
          fallback: true,
        });
      }

      const { topic, context, question } = req.body;

      const ai = new GoogleGenAI({ apiKey });

      const prompt = `You are a distinguished Bioimaging professor teaching BME 360: Introduction to Bioimaging (Fourier Transform, k-Space, Medical Imaging & Segmentation).
Context of current student experiment:
- Topic: ${topic || "Fourier Transform in Bioimaging"}
- Current Filter State: ${JSON.stringify(context?.filter || {})}
- Image Modality: ${context?.modality || "General/Bioimaging"}
- Student Question/Inquiry: ${question || "Explain what is happening in the frequency domain with this filter setup."}

Please give a clear, pedagogical, concise response (2-3 short paragraphs or clean bullet points). Explain:
1. The mathematical/physical intuition (e.g. why low frequencies carry contrast/energy and high frequencies carry edges/noise, or how periodic spikes relate to cage bars).
2. What happened or will happen to the spatial image (blurring, Gibbs ringing phenomenon, edge isolation, artifact removal).
3. Practical bioimaging connection (MRI k-space trajectory, CT reconstruction, ultrasound speckle, or DICOM segmentation).
Keep your tone encouraging, rigorous yet intuitive for biomedical engineering undergraduate students.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
      });

      const explanation = response.text || "No explanation generated.";
      res.json({ explanation });
    } catch (err: any) {
      console.error("Gemini API error:", err);
      res.status(500).json({
        error: err.message || "Failed to generate AI explanation.",
      });
    }
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BME 360 Studio Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
