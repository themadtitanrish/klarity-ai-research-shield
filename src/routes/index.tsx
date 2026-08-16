import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles, Copy, Check, X, RotateCcw, History } from "lucide-react";
import klarityLogo from "@/assets/klarity-logo.png.asset.json";
import { kickoffValidation, fetchValidationStatus } from "@/lib/crewai.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Klarity — Validate Any Research Topic with AI" },
      {
        name: "description",
        content:
          "Klarity checks the credibility of research topics across every academic field, scoring sources and synthesizing what the evidence actually supports.",
      },
      { property: "og:title", content: "Klarity — Validate Any Research Topic with AI" },
      {
        property: "og:description",
        content:
          "AI-powered credibility checking across every field of research. Score sources, spot weak evidence, get a clear synthesis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Source = { title: string; score?: number | undefined; description?: string | undefined };
type Parsed = {
  field?: string | undefined;
  sources: Source[];
  summary: string;
};

const HISTORY_KEY = "klarity.history";
const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

function Star({ className }: { className?: string }) {
  return (
    <Sparkles
      aria-hidden
      className={`pointer-events-none absolute text-foreground/40 twinkle ${className ?? ""}`}
    />
  );
}

function scoreClasses(score: number) {
  if (score >= 8) return "text-score-high border-score-high/30 bg-score-high/10";
  if (score >= 6) return "text-score-mid border-score-mid/30 bg-score-mid/10";
  return "text-score-low border-score-low/25 bg-score-low/10";
}

function parseRaw(raw: string): Parsed {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "")
    : trimmed;

  try {
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const sourcesRaw = (data["sources"] ?? data["credible_sources"]) as unknown;
    const sources: Source[] = Array.isArray(sourcesRaw)
      ? sourcesRaw
          .map((s) => {
            if (typeof s === "string") return { title: s };
            const o = s as Record<string, unknown>;
            const title = o["title"] ?? o["name"] ?? o["source"];
            if (typeof title !== "string") return null;
            const scoreVal = o["score"] ?? o["credibility_score"] ?? o["credibility"];
            const description = o["description"] ?? o["summary"] ?? o["notes"];
            return {
              title,
              score: typeof scoreVal === "number" ? scoreVal : undefined,
              description: typeof description === "string" ? description : undefined,
            } satisfies Source;
          })
          .filter((s): s is Source => s !== null)
      : [];

    const field = data["field"] ?? data["academic_field"] ?? data["discipline"];
    const summary = data["summary"] ?? data["research_summary"] ?? data["synthesis"];

    return {
      field: typeof field === "string" ? field : undefined,
      sources,
      summary: typeof summary === "string" ? summary : raw,
    };
  } catch {
    return { sources: [], summary: raw };
  }
}

function Index() {
  const [topic, setTopic] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<Parsed | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  const cancelRef = useRef(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const kickoff = useServerFn(kickoffValidation);
  const status = useServerFn(fetchValidationStatus);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored) as string[]);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  function saveHistory(entry: string) {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((p) => p !== entry)].slice(0, 8);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function friendly(message: string): string {
    if (message.startsWith("AUTH:"))
      return "The research service rejected our credentials. Please check the access token and try again.";
    if (message.startsWith("NETWORK:"))
      return "We couldn't reach the research service. Check your connection and try again.";
    if (message.startsWith("TIMEOUT:"))
      return "This validation is taking unusually long. Please try again in a moment.";
    if (message.startsWith("CREW:"))
      return "The research crew couldn't complete this validation. Try rephrasing your topic.";
    return "Something went wrong while validating this topic. Please try again.";
  }

  async function runValidation(t: string) {
    cancelRef.current = false;
    setIsRunning(true);
    setErrorMessage(null);
    setResult(null);
    setCopied(false);

    try {
      const { kickoffId } = await kickoff({ data: { topic: t } });
      saveHistory(t);
      const startedAt = Date.now();

      for (;;) {
        if (cancelRef.current) return;
        if (Date.now() - startedAt > TIMEOUT_MS) throw new Error("TIMEOUT:");

        const s = await status({ data: { kickoffId } });
        if (cancelRef.current) return;

        if (s.state === "SUCCESS") {
          setResult(parseRaw(s.raw ?? ""));
          return;
        }
        if (s.state === "FAILURE" || s.state === "FAILED" || s.state === "ERROR") {
          throw new Error(`CREW:${s.error ?? ""}`);
        }

        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (err) {
      if (cancelRef.current) return;
      setErrorMessage(friendly(err instanceof Error ? err.message : ""));
    } finally {
      if (!cancelRef.current) setIsRunning(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = topic.trim();
    if (t.length < 2 || isRunning) return;
    void runValidation(t);
  }

  function onCancel() {
    cancelRef.current = true;
    setIsRunning(false);
  }

  function onNewValidation() {
    cancelRef.current = true;
    setIsRunning(false);
    setResult(null);
    setErrorMessage(null);
    setTopic("");
  }

  async function onCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background font-sans">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-foreground/5 blur-[140px]" />
      <Star className="left-[12%] top-32 size-4" />
      <Star className="right-[16%] top-52 size-3 [animation-delay:1.2s]" />
      <Star className="left-[22%] bottom-40 size-3 [animation-delay:2.1s]" />
      <Star className="right-[10%] bottom-24 size-4 [animation-delay:0.6s]" />

      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <img
            src={klarityLogo.url}
            alt="Klarity logo"
            className="h-20 w-auto select-none object-contain mix-blend-screen sm:h-24"
          />
          <span className="text-lg font-semibold tracking-tight text-foreground">{"\n"}</span>
        </div>
        <nav className="flex items-center gap-7 text-sm text-muted-foreground">
          <a href="#validate" className="transition-colors hover:text-foreground">
            Validate
          </a>
          <a href="#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
        </nav>
      </header>

      <main className="relative mx-auto w-full max-w-3xl px-6 pb-28">
        <section className="pt-20 text-center sm:pt-28">
          <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-6xl">
            Validate any research topic
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            AI-powered credibility checking across every field of research
          </p>
        </section>

        <section id="validate" className="mt-14">
          <form onSubmit={onSubmit} className="glass glass-hover rounded-2xl p-6 sm:p-8">
            <label
              htmlFor="topic"
              className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
            >
              Research topic
            </label>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter a topic, like 'protein content in crickets'"
                className="w-full rounded-xl border border-border bg-foreground/[0.03] px-4 py-3.5 text-base text-foreground outline-hidden transition placeholder:text-muted-foreground/70 focus:border-foreground/30 focus:ring-2 focus:ring-ring/40"
              />
              <button
                type="submit"
                disabled={isRunning || topic.trim().length < 2}
                className="shrink-0 rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_30px_-4px_rgb(255_255_255/0.45)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:shadow-none"
              >
                {isRunning ? "Validating…" : "Validate"}
              </button>
              {isRunning && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="shrink-0 rounded-full border border-border bg-foreground/[0.04] px-6 py-3.5 text-sm font-medium text-foreground transition-all duration-300 hover:border-foreground/30 hover:bg-foreground/[0.08]"
                >
                  <span className="inline-flex items-center gap-2">
                    <X className="size-3.5" aria-hidden />
                    Cancel
                  </span>
                </button>
              )}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Klarity identifies the academic field, weighs the evidence, and scores each source.
            </p>

            {history.length > 0 && (
              <div className="mt-6 border-t border-border/60 pt-5">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  <History className="size-3" aria-hidden />
                  Recent
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {history.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setTopic(h)}
                      className="rounded-full border border-border bg-foreground/[0.03] px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        </section>

        {isRunning && (
          <section className="reveal mt-8">
            <div className="glass rounded-2xl px-6 py-8 text-center">
              <div className="breathe flex items-center justify-center gap-3">
                <Sparkles className="size-4 text-foreground" aria-hidden />
                <span className="text-sm text-foreground">Analyzing sources…</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Reviewing literature, weighting credibility, synthesizing findings.
              </p>
            </div>
          </section>
        )}

        {errorMessage && !isRunning && (
          <section className="reveal mt-8">
            <div className="glass rounded-2xl px-6 py-7 text-center">
              <p className="text-sm text-destructive">{errorMessage}</p>
              <button
                type="button"
                onClick={onNewValidation}
                className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-foreground/[0.04] px-5 py-2.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[0.08]"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                New validation
              </button>
            </div>
          </section>
        )}

        {result && !isRunning && (
          <section ref={resultsRef} className="mt-10 space-y-4" aria-live="polite">
            <div className="reveal flex flex-wrap items-center justify-between gap-3">
              {result.field ? (
                <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs text-foreground">
                  <Sparkles className="size-3" aria-hidden />
                  Field: {result.field}
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={onNewValidation}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-foreground/[0.04] px-4 py-2 text-xs font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[0.08]"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                New validation
              </button>
            </div>

            {result.sources.length > 0 && (
              <div className="space-y-3">
                {result.sources.map((s, i) => (
                  <article
                    key={`${s.title}-${i}`}
                    className="glass glass-hover reveal rounded-2xl p-5 sm:p-6"
                    style={{ animationDelay: `${100 + i * 80}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-base font-medium leading-snug text-foreground">
                        {s.title}
                      </h3>
                      {typeof s.score === "number" && (
                        <span
                          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums ${scoreClasses(s.score)}`}
                        >
                          {s.score.toFixed(1)}
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        {s.description}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}

            <div
              className="glass glass-hover reveal rounded-3xl p-7 sm:p-9"
              style={{ animationDelay: `${160 + result.sources.length * 80}ms` }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-foreground" aria-hidden />
                  <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Synthesis
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onCopy}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-foreground/[0.04] px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  {copied ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <Copy className="size-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-lg leading-relaxed text-foreground">
                {result.summary}
              </p>
            </div>
          </section>
        )}

        <section id="how" className="mt-24 grid gap-3 sm:grid-cols-3">
          {[
            ["Field detection", "Klarity classifies your topic into its academic discipline."],
            ["Source scoring", "Each body of evidence is rated 0–10 for credibility."],
            ["Honest synthesis", "A sober summary of what the evidence actually supports."],
          ].map(([title, body]) => (
            <div key={title} className="glass glass-hover rounded-2xl p-5">
              <h3 className="text-sm font-medium text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        Klarity — research validation, not a substitute for peer review.
      </footer>
    </div>
  );
}
