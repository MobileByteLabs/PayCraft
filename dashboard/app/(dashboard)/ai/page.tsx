import { AiChat } from "@/components/ai-chat"

export const metadata = { title: "PayCraft AI" }

export default function PayCraftAIPage() {
  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col p-4">
      <header className="mb-3">
        <h1 className="text-2xl font-bold">PayCraft AI</h1>
        <p className="text-sm text-gray-500">
          Your Growth Copilot — ask how to increase your MRR, or say &ldquo;automate everything&rdquo;.
          It answers from PayCraft&rsquo;s knowledge plus your live numbers.
        </p>
      </header>
      <div className="flex-1 overflow-hidden rounded-lg border bg-white">
        <AiChat />
      </div>
    </div>
  )
}
