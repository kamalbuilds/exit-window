"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const HEX_ADDR = /^0x[a-fA-F0-9]{40}$/;

export function AddressForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const valid = HEX_ADDR.test(value.trim());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) router.push(`/w/${value.trim()}`);
      }}
      className="w-full max-w-xl"
    >
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x… Hyperliquid wallet address"
          className="num flex-1 bg-bg-raised border border-line rounded-sm px-3 py-2.5 text-sm outline-none focus:border-amber placeholder:text-fg-faint"
          aria-invalid={touched && !valid}
        />
        <button
          type="submit"
          className="bg-amber text-bg font-medium text-sm px-4 py-2.5 rounded-sm hover:brightness-110 transition-[filter] shrink-0"
        >
          Open the window
        </button>
      </div>
      {touched && !valid ? (
        <p className="mt-1.5 text-xs text-red" role="alert">
          Enter a valid 0x wallet address (42 hex characters).
        </p>
      ) : null}
    </form>
  );
}
