# Accessibility

Care Circle is built for older adults and for people who use screen readers, keyboards, magnification or voice control. The target is WCAG 2.2 AA where practical. Automated checks (axe, keyboard and accessible-name tests, live-region and focus tests) run in `npm test`; they do **not** replace testing with real assistive technology, so use the script below.

## What is implemented

- **Structure and navigation:** skip link, landmarks, one `h1` per page, a route focus manager that moves focus to the new page heading, patient navigation with `aria-current`.
- **Forms:** every input has a visible label; hints and errors are tied with `aria-describedby`; an error summary receives focus and links to each field; required and invalid state is exposed.
- **Announcements:** a polite/assertive live-region announcer reports saves, errors and AI replies. Status is never conveyed by colour alone (text labels for statuses and low-confidence fields).
- **Names that carry context:** buttons repeat the medicine or task in a visually hidden suffix ("Mark done: Arrange transport"), so lists make sense when read out of context.
- **Display settings:** text size, high contrast, reduced motion, and read-aloud of key screens and AI replies using the browser's speech synthesis.
- **Simplified patient screen:** large touch targets, one clear next action, plain language.
- **Keyboard:** every control reachable and operable; the appointment calendar is a grid with roving tabindex; dialogs trap and restore focus; images and PDFs have text alternatives and controls.
- **Charts:** every chart has a text summary and a data table.
- **PIN lock (optional):** on-device only (PBKDF2); never sent to the server.
- **AI screens:** AI-generated content is labelled, uncertainty is stated in words, and nothing is applied without an explicit, labelled button.

## Manual test script

Run with a real screen reader (VoiceOver on macOS/iOS, NVDA on Windows, TalkBack on Android) and keyboard only. Use synthetic data.

1. **Sign in** with the keyboard only. Submit the form empty: the error summary should receive focus and each link should land on its field.
2. **Skip link:** press Tab once on any page; "Skip to main content" should appear and work.
3. **Dashboard:** navigate by headings and landmarks. Confirm the page title is announced after each navigation.
4. **Report a dose** as the patient: the control name should include the medicine and time; after pressing it, the result should be announced without moving focus unexpectedly.
5. **Add a medicine:** complete the form with a screen reader; errors must be announced and reachable.
6. **Scan a prescription:** upload a sample, then on the review page confirm that "check this" fields are announced as such, that the original image has a description, and that approving a medicine announces the outcome.
7. **Reconciliation:** read the comparison table with table navigation; differences should be announced as "possibly different".
8. **Care assistant:** send a question; the reply should be announced. Ask it to snooze a reminder and confirm that **Yes, do it** and **No, cancel** are reachable and clearly named.
9. **Tasks and handover:** complete a task with the keyboard; share and acknowledge a handover; check the activity feed is readable.
10. **Display settings:** increase text size to the maximum and enable high contrast; check nothing is clipped at 200% and 400% zoom (320 px wide).
11. **Mobile:** repeat steps 1, 4 and 8 on a phone with TalkBack or VoiceOver.

Record failures as issues with the screen reader, browser and steps.
