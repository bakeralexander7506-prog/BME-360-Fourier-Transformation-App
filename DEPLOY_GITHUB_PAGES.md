# Deploying to GitHub Pages

This application is fully compatible with GitHub Pages. All core bioimaging algorithms—including the **2D Fourier Transform (FFT/IFFT)**, **k-Space filtering**, **DICOM multi-slice parsing**, **HU windowing**, **Otsu thresholding**, **region growing**, **Multi-Planar Reconstruction (Axial, Coronal, Sagittal)**, and **camera uploads**—execute 100% client-side in the browser.

---

## Method 1: Automatic Deployment with GitHub Actions (Recommended)

A pre-configured GitHub Actions workflow is included at `.github/workflows/deploy.yml`.

1. **Push your code to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for BME 360 Studio"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

2. **Enable GitHub Pages via Actions**:
   - Go to your repository on GitHub.
   - Click **Settings** > **Pages** (in the left sidebar).
   - Under **Build and deployment** > **Source**, select **GitHub Actions**.
   - That's it! Every time you push to `main` or `master`, the workflow will automatically compile the Vite bundle and publish the site.

3. **View Your Live Site**:
   - Your site will be live at:
     `https://<your-username>.github.io/<your-repo-name>/`

---

## Method 2: Manual CLI Deployment via `gh-pages`

If you prefer deploying directly from your terminal:

1. **Run the deploy script**:
   ```bash
   npm run deploy
   ```
   *(This executes `vite build` and pushes the `dist/` directory directly to your `gh-pages` branch).*

2. **Verify Pages Settings**:
   - Go to **Settings** > **Pages** on GitHub.
   - Ensure the Source is set to **Deploy from a branch** and select the `gh-pages` branch (`/ (root)`).

---

## Key Configurations Applied

- **Relative Asset Base (`base: './'`)**:
  Configured in `vite.config.ts` so that all generated scripts, stylesheets, and images load correctly regardless of whether your repository is hosted at the root domain (`username.github.io`) or in a subpath (`username.github.io/repo-name/`).

- **SPA 404 Fallback (`public/404.html`)**:
  Includes a lightweight redirect script so page refreshes and direct links do not trigger standard GitHub 404 errors.

- **Offline / PWA Ready**:
  Web app manifest and icons are configured with relative scope so users can install the app to their home screen or desktop directly from GitHub Pages.
