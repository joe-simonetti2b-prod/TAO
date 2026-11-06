package fr.weave.tao;

// TAO – synthèse des stimuli (portage exact de synth() de www/js/audio.js).
// Classe Java pure, sans dépendance Android : testable sur ordinateur.
// © 2026 Joseph-Marie Simonetti – Weave. Tous droits réservés.

public final class TaoSynth {
    private TaoSynth() {}

    private static final double TAU = Math.PI * 2;

    public static String themeKey(int freq) {
        switch (freq) {
            case 500: return "corne";
            case 1000: return "telephone";
            case 2000: return "clochette";
            case 3000: return "sifflet";
            case 4000: return "oiseau";
            default: return null;
        }
    }

    private static double rampGain(int i, int n, int rampN) {
        if (i < rampN) return 0.5 - 0.5 * Math.cos(Math.PI * i / rampN);
        if (i > n - rampN) return 0.5 - 0.5 * Math.cos(Math.PI * (n - i) / rampN);
        return 1;
    }

    private interface Env { double at(double t, int idx); }
    private interface Fq { double at(double t, int idx); }

    /** Segments [start, len, idx] identiques à segments() en JS. */
    private static int[][] segments(int totalN, int sr, double onS, double offS, int groupSize, double groupPauseS) {
        java.util.ArrayList<int[]> out = new java.util.ArrayList<>();
        int t = 0, k = 0;
        int on = (int) Math.round(onS * sr), off = (int) Math.round(offS * sr), gp = (int) Math.round(groupPauseS * sr);
        int minLen = (int) Math.round(0.06 * sr);
        while (t < totalN) {
            int len = Math.min(on, totalN - t);
            if (len < minLen && !out.isEmpty()) break;
            out.add(new int[]{t, len, k});
            t += on + off; k++;
            if (groupSize > 0 && k % groupSize == 0) t += gp;
        }
        return out.toArray(new int[0][]);
    }

    private static void fill(float[] out, int sr, double freq, int start, int len, int idx, Env env, Fq fq, double rampS) {
        int rampN = Math.max(1, (int) Math.round(rampS * sr));
        double ph = 0;
        for (int i = 0; i < len; i++) {
            double t = (double) i / sr;
            double f = fq != null ? fq.at(t, idx) : freq;
            ph += TAU * f / sr;
            out[start + i] = (float) (Math.sin(ph) * env.at(t, idx) * rampGain(i, len, rampN));
        }
    }

    /**
     * Mono, enveloppe crête = 1.
     * type : "theme" | "pulsed" | "pure"
     */
    public static float[] synth(final double freq, String type, double durationS, int sr) {
        int n = (int) Math.round(durationS * sr);
        float[] out = new float[n];
        String theme = "theme".equals(type) ? themeKey((int) Math.round(freq)) : null;

        if ("pure".equals(type)) {
            fill(out, sr, freq, 0, n, 0, (t, i) -> 1, null, 0.03);
            return out;
        }
        if (theme == null) { // son pur pulsé 225/225 ms, rampes 25 ms
            for (int[] s : segments(n, sr, 0.225, 0.225, 0, 0)) fill(out, sr, freq, s[0], s[1], s[2], (t, i) -> 1, null, 0.025);
            return out;
        }
        switch (theme) {
            case "corne":
                fill(out, sr, freq, 0, n, 0, (t, i) -> (0.78 + 0.22 * Math.sin(TAU * 2 * t)) / 1.0,
                        (t, i) -> freq * (1 + 0.03 * Math.sin(TAU * 4 * t)), 0.08);
                break;
            case "telephone":
                for (int[] s : segments(n, sr, 0.8, 0.25, 0, 0))
                    fill(out, sr, freq, s[0], s[1], s[2],
                            (t, i) -> 0.55 + 0.45 * (0.5 * (1 + Math.tanh(4 * Math.sin(TAU * 20 * t)))), null, 0.02);
                break;
            case "clochette":
                for (int[] s : segments(n, sr, 0.45, 0.08, 0, 0))
                    fill(out, sr, freq, s[0], s[1], s[2], (t, i) -> Math.exp(-7 * t), null, 0.006);
                break;
            case "sifflet":
                for (int[] s : segments(n, sr, 0.9, 0.2, 0, 0))
                    fill(out, sr, freq, s[0], s[1], s[2], (t, i) -> 0.8 + 0.2 * Math.sin(TAU * 25 * t),
                            (t, i) -> freq * (1 + 0.015 * Math.sin(TAU * 25 * t)), 0.02);
                break;
            case "oiseau":
                for (int[] s : segments(n, sr, 0.11, 0.06, 5, 0.22))
                    fill(out, sr, freq, s[0], s[1], s[2], (t, i) -> 1, (t, i) -> {
                        double x = Math.min(1, t / 0.11);
                        boolean up = i % 2 == 0;
                        return freq * (up ? 0.94 + 0.12 * x : 1.06 - 0.11 * x);
                    }, 0.012);
                break;
            default: break;
        }
        // Normalisation : enveloppe crête exactement 1 (en JS, calculée sur les valeurs float32)
        float pk = 0;
        for (int i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
        if (pk > 0) for (int i = 0; i < n; i++) out[i] = out[i] / pk;
        return out;
    }

    /** Stéréo entrelacé : signal sur une seule oreille, l'autre canal à zéro absolu. */
    public static float[] stereo(float[] mono, boolean right, double amp) {
        float[] st = new float[mono.length * 2];
        int ch = right ? 1 : 0; // 0 = gauche, 1 = droite
        for (int i = 0; i < mono.length; i++) st[2 * i + ch] = (float) (mono[i] * amp);
        return st;
    }
}
