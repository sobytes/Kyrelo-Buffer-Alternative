export default function TutorialPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 pb-6 pt-10">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Tutorial</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Get started with Kyrelo — connect an account, schedule posts, and watch handles.
      </p>

      <ol className="mt-6 space-y-4 text-sm text-zinc-300">
        <li>
          <span className="font-medium text-zinc-100">1. Connect an X account.</span>{" "}
          Open <span className="text-accent">Connected</span> and sign in to the X account
          you want Kyrelo to post from. Your session lives only on this machine.
        </li>
        <li>
          <span className="font-medium text-zinc-100">2. Schedule a post.</span>{" "}
          Go to <span className="text-accent">Scheduler</span>, draft your post, pick a time,
          and queue it. The local worker publishes it at the scheduled time.
        </li>
        <li>
          <span className="font-medium text-zinc-100">3. Watch handles.</span>{" "}
          In <span className="text-accent">Monitor</span>, add the handles you want to track.
          Kyrelo will surface new posts and draft AI replies for review.
        </li>
        <li>
          <span className="font-medium text-zinc-100">4. Tune your AI provider.</span>{" "}
          Add an API key in <span className="text-accent">Settings</span> and pick the model
          and reply tone that fit your voice.
        </li>
      </ol>
    </main>
  );
}
