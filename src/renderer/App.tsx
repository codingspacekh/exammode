import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';

/** M0: a placeholder in the prototype's look (design/screens/01-join.html). The real screens come in M3. */
export function App() {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(1200px_600px_at_50%_0%,#e7ebfb_0%,var(--background)_60%)]">
      <div className="flex w-[min(560px,92%)] flex-col items-start gap-4 rounded-[14px] border border-border bg-card px-9 py-8 shadow-md">
        <div className="flex items-center gap-2.5">
          <Logo className="size-7" />
          <h1 className="text-[22px] font-semibold tracking-tight">ExamMode</h1>
        </div>
        <p className="text-[14px] text-muted-foreground">Foundations (M0). The student and teacher screens come next.</p>
        <Button size="lg">Join an exam</Button>
      </div>
    </main>
  );
}
