import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="hero-bg relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-20">
      {/* radar rings — same vibe as the app icon */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="absolute h-[520px] w-[520px] rounded-full border border-line/40" />
        <div className="absolute h-[360px] w-[360px] rounded-full border border-line/30" />
        <div className="absolute h-[220px] w-[220px] rounded-full border border-line/20" />
        <span className="live-dot absolute" />
      </div>

      <div className="relative z-10 max-w-xl text-center">
        <Image
          src="/icon.png"
          alt=""
          width={56}
          height={56}
          className="mx-auto rounded-xl opacity-80"
        />

        <h1 className="mt-8 bg-gradient-to-br from-accent via-accent to-live bg-clip-text text-[140px] font-bold leading-none tracking-tighter text-transparent sm:text-[180px]">
          404
        </h1>

        <p className="mt-2 text-base font-semibold uppercase tracking-[0.18em] text-zinc-400">
          Lost in the timeline
        </p>

        <p className="mx-auto mt-5 max-w-md text-pretty text-base leading-relaxed text-zinc-400">
          The page you&apos;re looking for doesn&apos;t exist — or got
          unscheduled before you arrived. Pick a direction:
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="btn-primary">
            Back to home
          </Link>
          <a
            href="https://github.com/sobytes/Kyrelo-Buffer-Alternative/releases"
            className="btn-ghost"
            target="_blank"
            rel="noreferrer"
          >
            Download Kyrelo
          </a>
        </div>
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        .live-dot {
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          background: #10b981;
          box-shadow: 0 0 0 8px rgba(16, 185, 129, 0.15), 0 0 40px rgba(16, 185, 129, 0.5);
          animation: pulse-ring 2.4s ease-in-out infinite;
        }
      `}</style>
    </main>
  );
}
