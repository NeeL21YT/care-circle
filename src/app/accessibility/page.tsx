import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Accessibility statement" };

export default function AccessibilityPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/" className="font-semibold text-primary underline">Back to home</Link>
      <main id="main-content" className="prose-like mt-6 space-y-6 text-lg">
        <h1 id="page-title" tabIndex={-1} className="text-4xl font-extrabold">Accessibility statement</h1>
        <p>Care Circle is designed to be used by older adults and by people who are blind, have low vision, have limited dexterity, or use assistive technology. Our target is WCAG 2.2 level AA.</p>

        <h2 className="text-2xl font-bold">What we have built in</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li><strong>Screen readers.</strong> Pages use real headings, landmarks, lists and tables. Every control has a name that includes what it acts on, for example “I took it, Metformin, 8:00 AM”. Results of actions are announced through live regions, and focus moves to the new page heading after navigation.</li>
          <li><strong>Keyboard.</strong> Everything works without a mouse. A “Skip to main content” link is the first thing you reach. Focus is always visible, and dialogs trap and restore focus.</li>
          <li><strong>Forms.</strong> Every field has a visible label, hint and error. After a failed submit, an error summary receives focus and links to each problem.</li>
          <li><strong>Large text and contrast.</strong> Text size (standard, large, extra large) and a high-contrast mode are in Display settings. The app also follows your device&apos;s high-contrast and reduced-motion settings, and you can zoom to 200% or more without losing content.</li>
          <li><strong>Not colour alone.</strong> Statuses always combine an icon and words. Chart bars use patterns, and every chart has a text summary and a data table.</li>
          <li><strong>Read aloud.</strong> A “Read my day aloud” button speaks your medicines and appointments using your browser&apos;s voice, with an adjustable speed.</li>
          <li><strong>Large targets.</strong> Buttons are at least 48 pixels tall, with the main medicine actions larger still.</li>
        </ul>

        <h2 className="text-2xl font-bold">Known limitations</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Emails use plain HTML with a text version. Please tell us if one is hard to read with your software.</li>
          <li>Voice input and a voice assistant are planned for a later phase.</li>
          <li>Scanned documents you upload are shown as files. We do not yet read their contents aloud.</li>
        </ul>

        <h2 className="text-2xl font-bold">Tell us about a problem</h2>
        <p>If something does not work with your assistive technology, please contact the person who set up your care circle or your service provider so we can fix it. Include the page, your browser and the assistive technology you use.</p>
      </main>
    </div>
  );
}
