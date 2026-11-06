package fr.weave.tao;

// TAO – analyse spectrale du micro, calquée sur l'AnalyserNode du moteur web
// (fenêtre de Blackman, FFT 8192, |X|/N, lissage temporel 0,6, dB = 20·log10).
// Classe Java pure, testable sur ordinateur.
// © 2026 Joseph-Marie Simonetti – Weave. Tous droits réservés.

public final class TaoSpectrum {
    public final int n;
    public final int sr;
    private final double smoothing;
    private final double[] win, re, im, smooth;
    private final double[] aw; // pondération A (en puissance) par case
    private boolean first = true;

    public TaoSpectrum(int n, int sr, double smoothing) {
        this.n = n; this.sr = sr; this.smoothing = smoothing;
        win = new double[n]; re = new double[n]; im = new double[n]; smooth = new double[n / 2];
        for (int i = 0; i < n; i++) {
            double x = (double) i / n;
            win[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
        }
        aw = new double[n / 2];
        double hz = (double) sr / n;
        for (int i = 0; i < n / 2; i++) {
            double f = Math.max(1, i * hz), f2 = f * f;
            double ra = (Math.pow(12194, 2) * f2 * f2) / ((f2 + Math.pow(20.6, 2)) * Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2))) * (f2 + Math.pow(12194, 2)));
            double a = 20 * Math.log10(ra) + 2.0;
            aw[i] = f < 20 ? 0 : Math.pow(10, a / 10);
        }
    }

    /** Ajoute une trame de n échantillons (les plus récents). */
    public synchronized void push(float[] frame) {
        for (int i = 0; i < n; i++) { re[i] = frame[i] * win[i]; im[i] = 0; }
        fft(re, im);
        for (int k = 0; k < n / 2; k++) {
            double mag = Math.hypot(re[k], im[k]) / n;
            smooth[k] = first ? mag : smoothing * smooth[k] + (1 - smoothing) * mag;
        }
        first = false;
    }

    private double binDb(int k) { return 20 * Math.log10(smooth[k] + 1e-30); }

    /** Niveau dans la bande d'octave centrée sur f (même formule que bandLevel en JS). */
    public synchronized double band(double f) {
        double hz = (double) sr / n;
        int lo = (int) Math.floor(f / Math.sqrt(2) / hz), hi = (int) Math.ceil(f * Math.sqrt(2) / hz);
        double p = 0;
        for (int i = lo; i <= hi && i < n / 2; i++) p += Math.pow(10, binDb(i) / 10);
        return 10 * Math.log10(p + 1e-20);
    }

    /** Niveau global pondéré A (relatif). */
    public synchronized double levelA() {
        double p = 0;
        for (int i = 1; i < n / 2; i++) p += Math.pow(10, binDb(i) / 10) * aw[i];
        return 10 * Math.log10(p + 1e-20);
    }

    public synchronized boolean ready() { return !first; }

    // FFT radix-2 en place
    static void fft(double[] re, double[] im) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
            for (int i = 0; i < n; i += len) {
                double cr = 1, ci = 0;
                for (int k = 0; k < len / 2; k++) {
                    int a = i + k, b = a + len / 2;
                    double xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                    double t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
                }
            }
        }
    }
}
