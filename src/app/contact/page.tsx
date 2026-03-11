'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

const INPUT_CLASS =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-spert-blue focus:outline-none focus:ring-1 focus:ring-spert-blue dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-blue-400 dark:focus:ring-blue-400';

export default function ContactPage() {
  const [status, setStatus] = useState<FormStatus>('idle');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('submitting');

    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      const res = await fetch('https://formspree.io/f/xeeloewp', {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        setStatus('success');
        form.reset();
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <Header linkHome />

      <main id="main-content" className="max-w-xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          &larr; Back to apps
        </Link>

        <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">
          Contact Me
        </h2>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Have a question, suggestion, or feedback? Send me a message.
        </p>

        {status === 'success' ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950">
            <p className="text-lg font-medium text-emerald-700 dark:text-emerald-300">
              Message sent!
            </p>
            <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">
              Thank you for reaching out. I&apos;ll get back to you soon.
            </p>
            <button
              type="button"
              onClick={() => setStatus('idle')}
              className="mt-4 text-sm font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200 transition-colors"
            >
              Send another message
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="name"
                className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className={INPUT_CLASS}
                placeholder="Your name"
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                className={INPUT_CLASS}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="message"
                className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Message
              </label>
              <textarea
                id="message"
                name="message"
                required
                rows={5}
                className={INPUT_CLASS}
                placeholder="Your message..."
              />
            </div>

            {status === 'error' && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Something went wrong. Please try again.
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="rounded-lg bg-spert-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-spert-blue-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'submitting' ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}
      </main>

      <Footer />
    </div>
  );
}
