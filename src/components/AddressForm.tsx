"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const HEX_ADDR = /^0x[a-fA-F0-9]{40}$/;

export function AddressForm({
  initial = "",
  target = "me",
  label = "Your Hyperliquid address",
  cta = "Find my exits",
}: {
  initial?: string;
  target?: "me" | "w";
  label?: string;
  cta?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const valid = HEX_ADDR.test(value.trim());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) router.push(`/${target}/${value.trim()}`);
      }}
      className="w-full"
    >
      <label htmlFor={`wallet-${target}`} className="label block mb-2">
        {label}
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id={`wallet-${target}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x Hyperliquid address"
          spellCheck={false}
          autoComplete="off"
          className="fig flex-none sm:flex-1 min-w-0 h-11 bg-dial border border-ink-3 rounded-[var(--radius-control)] px-3 text-[14px] text-ink placeholder:text-ink-3 transition-[border-color] duration-150 focus:border-ink"
          aria-invalid={touched && !valid}
          aria-describedby={touched && !valid ? "wallet-error" : undefined}
        />
        <button
          type="submit"
          className="h-11 px-5 bg-ink text-paper font-medium text-[15px] rounded-[var(--radius-control)] whitespace-nowrap transition-[background-color] duration-150 hover:bg-ink-2"
        >
          {cta}
        </button>
      </div>
      {touched && !valid ? (
        <p id="wallet-error" className="mt-2 text-[13px] text-late" role="alert">
          That is not a wallet address. It should be 0x followed by 40 hex characters.
        </p>
      ) : null}
    </form>
  );
}
