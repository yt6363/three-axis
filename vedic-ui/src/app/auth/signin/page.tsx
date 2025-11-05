import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-mono text-4xl tracking-widest text-green-400 mb-4">
            THREE AXIS
          </h1>
          <p className="text-sm text-zinc-400 uppercase tracking-wider">
            Sign in to access your terminal
          </p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-zinc-900 border border-zinc-800 rounded-none shadow-2xl",
            }
          }}
        />
      </div>
    </div>
  );
}
