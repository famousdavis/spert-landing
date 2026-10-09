// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { FormPageShell } from '@/components/FormPageShell';
import { AppCheckboxGroup } from '@/components/AppCheckboxGroup';

export default function TrainingPage() {
  return (
    <FormPageShell
      formspreeId="mreyygbb"
      title="I Want Training"
      subtitle="William W. Davis, creator of the SPERT® Suite, offers affordable live virtual training for individuals and teams. Use the form below to request a free consultation about your training needs, objectives, and any scheduling or budget constraints."
      submitLabel="Request Consultation"
      successMessage="Request received!"
      successDetail="Thank you! I'll be in touch soon to set up your free consultation."
    >
      <AppCheckboxGroup legend="Which tools are you interested in?" />
    </FormPageShell>
  );
}
