// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { FormPageShell } from '@/components/FormPageShell';
import { AppCheckboxGroup } from '@/components/AppCheckboxGroup';

export default function RequestPage() {
  return (
    <FormPageShell
      formspreeId="xojkkago"
      title="I Have a Request"
      subtitle="Have a feature idea or improvement suggestion? Let me know."
      submitLabel="Submit Request"
      successMessage="Request received!"
      successDetail="Thank you for your suggestion. I'll review it soon."
    >
      <AppCheckboxGroup />
    </FormPageShell>
  );
}
