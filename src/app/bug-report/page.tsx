// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { FormPageShell } from '@/components/FormPageShell';
import { AppCheckboxGroup } from '@/components/AppCheckboxGroup';

export default function BugReportPage() {
  return (
    <FormPageShell
      formspreeId="mreyygbb"
      title="I Found a Bug"
      subtitle="Found something that isn't working right? Please describe the issue."
      submitLabel="Submit Bug Report"
      successMessage="Bug report received!"
      successDetail="Thank you for reporting this. I'll look into it."
    >
      <AppCheckboxGroup />
    </FormPageShell>
  );
}
