// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import Link from 'next/link';
import { FormPageShell } from '@/components/FormPageShell';

const LINK_CLASS =
  'text-blue-600 underline underline-offset-2 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300';

export default function ContactPage() {
  return (
    <FormPageShell
      formspreeId="xeeloewp"
      title="Contact Me"
      subtitle="Have a question, suggestion, or feedback? Send me a message."
      note={
        <>
          To report a security vulnerability, email{' '}
          <a href="mailto:security@spertsuite.com" className={`${LINK_CLASS} font-semibold`}>
            security@spertsuite.com
          </a>{' '}
          or see the{' '}
          <Link href="/security" className={LINK_CLASS}>
            Security
          </Link>{' '}
          page. For privacy requests, email{' '}
          <a href="mailto:privacy@spertsuite.com" className={`${LINK_CLASS} font-semibold`}>
            privacy@spertsuite.com
          </a>
          .
        </>
      }
    />
  );
}
