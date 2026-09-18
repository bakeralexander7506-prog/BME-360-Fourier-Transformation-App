import React, { useState } from 'react';
import { Sparkles, X, Send, BookOpen, AlertCircle, Loader2 } from 'lucide-react';
import { FilterSettings, DicomMetadata } from '../types';

interface AITutorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTopic: string;
  currentFilter: FilterSettings;
  dicomMetadata?: DicomMetadata | null;
}

const QUICK_QUESTIONS = [
  'Why does an Ideal Lowpass filter cause ringing (Gibbs phenomenon)?',
  'How do the periodic cage bars in "Free the Tiger" produce harmonic spikes in k-space?',
  'What is the physical meaning of DC (center) vs high frequencies in MRI?',
  'How do Window Center (WC) and Window Width (WW) work in CT Hounsfield Units?',
  'Why do Butterworth and Gaussian filters avoid ripples in reconstructed images?',
];

export const AITutorModal: React.FC<AITutorModalProps> = ({
  isOpen,
  onClose,
  activeTopic,
  currentFilter,
  dicomMetadata,
}) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAsk = async (queryText?: string) => {
    const q = queryText || question;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/gemini/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: activeTopic,
          question: q,
          context: {
            filter: currentFilter,
            modality: dicomMetadata?.modality || 'General Bioimaging',
          },
        }),
      });

      const data = await res.json();
      if (res.ok && data.explanation) {
        setResponse(data.explanation);
      } else {
        // High quality educational fallback for common BME 360 topics
        setResponse(getEducationalFallback(q, currentFilter));
      }
    } catch {
      setResponse(getEducationalFallback(q, currentFilter));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
      <div className="flex flex-col w-full max-w-2xl max-h-[88vh] rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">BME 360 AI Bioimaging Tutor</h2>
              <p className="text-xs text-slate-400">Fourier Transform & k-Space pedagogical explanations</p>
            </div>
          </div>
          <button
            id="close-ai-tutor-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Quick Prompts */}
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Recommended BME 360 Concept Questions
            </span>
            <div className="flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setQuestion(q);
                    handleAsk(q);
                  }}
                  className="text-left text-xs bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/70 rounded-lg px-3 py-1.5 transition leading-snug"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* AI Response Card */}
          {response && (
            <div className="rounded-xl bg-slate-850 border border-sky-500/30 p-4 text-slate-200 text-sm leading-relaxed space-y-3">
              <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold uppercase tracking-wider">
                <BookOpen className="w-4 h-4" />
                <span>Professor's Explanation</span>
              </div>
              <div className="whitespace-pre-line text-xs sm:text-sm text-slate-300">
                {response}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/60 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-3 p-8 text-sky-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-xs">Formulating bioimaging concept analysis...</span>
            </div>
          )}
        </div>

        {/* Question Input Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex gap-2">
          <input
            id="ai-tutor-input"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            placeholder="Ask anything about Fourier Transform, filters, or medical imaging..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          <button
            id="ai-tutor-send-btn"
            onClick={() => handleAsk()}
            disabled={loading || !question.trim()}
            className="flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-semibold transition"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Ask</span>
          </button>
        </div>
      </div>
    </div>
  );
};

function getEducationalFallback(q: string, filter: FilterSettings): string {
  const lowerQ = q.toLowerCase();
  if (lowerQ.includes('gibbs') || lowerQ.includes('ringing') || lowerQ.includes('ideal')) {
    return `### Gibbs Phenomenon & Ideal Filter Ringing
1. **Mathematical Intuition**: An Ideal Lowpass filter in the frequency domain is a sharp step function (a cylinder of radius D0). By the Convolution Theorem, multiplying by a sharp step in frequency equals convolving in space with a 2D Bessel/Sinc function: $\\frac{J_1(2\\pi D_0 r)}{r}$.
2. **Spatial Effect**: Because the Sinc/Bessel function has prominent side-lobes that oscillate between positive and negative values, these oscillations ripple across sharp edges in your reconstructed image. This appears as "ringing artifacts" (concentric halos or ripples) around high-contrast edges.
3. **Clinical Relevance in Bioimaging**: In MRI, truncating k-space data acquisition (finite matrix size) creates truncation artifacts (Gibbs ringing), which can mimic a syrinx in spinal cord imaging. Using smooth filters like Butterworth or Gaussian dampens the side lobes, eliminating ripples at the cost of slight edge smoothing.`;
  }

  if (lowerQ.includes('tiger') || lowerQ.includes('cage') || lowerQ.includes('harmonic')) {
    return `### The "Free the Tiger" Periodic Noise Problem
1. **Physical Intuition**: The cage bars form a periodic spatial pattern repeating horizontally every T pixels. In Fourier theory, any periodic signal in space decomposes into discrete delta impulses (harmonics) at frequencies $f = \\pm k / T$.
2. **Frequency Domain Pattern**: Because the bars run vertically, their variation is purely along the horizontal (x) direction. Therefore, the periodic harmonics appear as bright symmetric points along the horizontal frequency axis ($u = \\pm 16, \\pm 32...$) in centered k-space.
3. **Notch Filter Solution**: By placing localized Notch reject filters centered exactly on those harmonic coordinates $(u_k, 0)$, we zero out the cage's periodic energy without disturbing the surrounding continuous spectrum of the tiger's face. Inverse FFT then reconstructs the tiger with the cage removed!`;
  }

  if (lowerQ.includes('dc') || lowerQ.includes('center') || lowerQ.includes('k-space')) {
    return `### Center vs Outer Edges of k-Space (MRI & 2D FFT)
1. **Center of k-Space (Low Frequencies)**:
   - Contains over 90% of the image's total signal energy.
   - Encodes overall tissue contrast, average brightness (the DC term $F(0,0) = \\sum f(x,y)$), and general gross anatomy (e.g. distinguishing white matter from gray matter).
2. **Perimeter of k-Space (High Frequencies)**:
   - Contains edge information, fine organ boundaries, micro-textures, and high-frequency noise.
   - Removing high frequencies results in image blurring (smoothing).
3. **MRI Fast Imaging**: In Keyhole imaging and compressed sensing, radiologists acquire the center of k-space frequently to capture dynamic contrast enhancement, while acquiring high frequencies less often to save scan time.`;
  }

  if (lowerQ.includes('window') || lowerQ.includes('hounsfield') || lowerQ.includes('ct')) {
    return `### CT Window Center (WC) & Window Width (WW)
1. **Hounsfield Unit (HU) Scale**: CT values represent linear X-ray attenuation coefficients relative to water:
   - Air: -1000 HU
   - Lung: -800 to -500 HU
   - Water: 0 HU
   - Soft Tissue (Liver, Muscle, Brain): +30 to +60 HU
   - Cortical Bone: +500 to +1500 HU
2. **Windowing Principle**: Human eyes can only distinguish ~30 shades of gray simultaneously, yet CT data spans over 2000 HU. Windowing maps a narrow slice $[WC - WW/2, WC + WW/2]$ to display 0–255 grayscale.
3. **Clinical Presets**:
   - **Lung Window** (WC -600, WW 1500): Highlights delicate bronchial and vascular architecture within air-filled lungs.
   - **Bone Window** (WC +400, WW 1800): Distinguishes fine trabecular fractures without saturation.
   - **Soft Tissue** (WC +40, WW 400): Differentiates tumor margins from normal muscle and fat.`;
  }

  return `### BME 360 Bioimaging Concept Summary
- **Current Filter**: ${filter.type.toUpperCase()} (${filter.shape}) with Cutoff Radius $D_0 = ${filter.cutoff}px$.
- **Image Domain**: Multiplying in the 2D frequency domain ($G(u,v) = F(u,v) \\cdot H(u,v)$) corresponds to spatial convolution ($g(x,y) = f(x,y) * h(x,y)$).
- **Smoothness vs Sharpness**: Ideal cutoffs cause Gibbs ringing artifacts due to Sinc oscillation in the spatial PSF. Butterworth and Gaussian filters provide graceful monotonic roll-offs, preserving tissue realism.`;
}
