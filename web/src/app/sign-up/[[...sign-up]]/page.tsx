import { SignUp } from '@clerk/nextjs';
import { Logo } from '@/components/Logo';

export default function SignUpPage() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center bg-neutral-950 px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <Logo size={40} />
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Talkie</h1>
          <p className="text-xs text-neutral-400">Create your account</p>
        </div>
      </div>
      <SignUp />
    </main>
  );
}
