import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-20 font-medium">Not found</h1>
      <p className="mt-1 text-13 text-mute">That lead is not in the list. It may have been erased.</p>
      <Link href="/" className="mt-3 inline-block text-link hover:underline">Back to the list</Link>
    </div>
  );
}
