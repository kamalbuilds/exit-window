"use client";

import Link from "next/link";
import { useState } from "react";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ place: number; alreadyJoined: boolean } | null>(null);

  const addressValid = address.trim() === "" || ADDRESS_RE.test(address.trim());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!email.trim() || !addressValid) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), address: address.trim() || undefined }),
      });
      const data = (await res.json()) as { place?: number; alreadyJoined?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "something went wrong, try again");
        return;
      }
      setResult({ place: data.place!, alreadyJoined: Boolean(data.alreadyJoined) });
    } catch {
      setError("could not reach the server, try again");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const trimmedAddress = address.trim();
    const meLink = trimmedAddress ? `/me/${trimmedAddress}` : "/";
    return (
      <div>
        <p className="text-[16px] text-ink">
          You&apos;re #{result.place} on the waitlist.
        </p>
        <p className="mt-2 text-[14px]">
          <Link href={meLink} className="text-accent hover:underline">
            Meanwhile, paste your address
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="waitlist-email" className="label block mb-2">
          Email
        </label>
        <input
          id="waitlist-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="h-10 w-full bg-paper border border-rule rounded-lg px-3 text-[14px] text-ink placeholder:text-ink-3 transition-[border-color] duration-150 focus:border-accent"
          aria-invalid={touched && !email.trim()}
          aria-describedby={touched && !email.trim() ? "waitlist-email-error" : undefined}
        />
        {touched && !email.trim() ? (
          <p id="waitlist-email-error" className="mt-2 text-[13px] text-late" role="alert">
            Email is required.
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="waitlist-address" className="label block mb-2">
          Hyperliquid address (optional)
        </label>
        <input
          id="waitlist-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x Hyperliquid address"
          spellCheck={false}
          autoComplete="off"
          className="fig h-10 w-full bg-paper border border-rule rounded-lg px-3 text-[14px] text-ink placeholder:text-ink-3 transition-[border-color] duration-150 focus:border-accent"
          aria-invalid={touched && !addressValid}
          aria-describedby={touched && !addressValid ? "waitlist-address-error" : undefined}
        />
        {touched && !addressValid ? (
          <p id="waitlist-address-error" className="mt-2 text-[13px] text-late" role="alert">
            That is not a wallet address. It should be 0x followed by 40 hex characters.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="text-[13px] text-late" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary h-9 px-5 text-[14px] whitespace-nowrap self-start active:scale-[0.97]"
      >
        {submitting ? "Joining..." : "Join the waitlist"}
      </button>
    </form>
  );
}
