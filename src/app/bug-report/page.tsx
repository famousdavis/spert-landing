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
