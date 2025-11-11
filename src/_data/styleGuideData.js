const fs = require('fs');
const path = require('path');

module.exports = {
  // Sample FAQs for the simple list component
  sampleListFaqs: [
    { question: "What is the Cyber Resilience Act (CRA)?", permalink: "#" },
    { question: "Who needs to comply with the CRA?", permalink: "#" },
    { question: "When does the CRA take effect?", permalink: "#" },
    { question: "What are the main requirements?", permalink: "#" }
  ],

  // Sample FAQs for the accordion component
  sampleAccordionFaqs: [
    {
      question: "How do I implement security updates?",
      answer: `Security updates should be implemented promptly following your organization's change management process. Always test in a staging environment first.

> [!WARNING]
> Never deploy updates directly to production without testing.

Key steps:
1. Review the security advisory
2. Test in staging
3. Deploy during maintenance window`,
      permalink: "#faq-1",
      filename: "security-updates.md",
      status: "approved",
      editOnGithubUrl: "#"
    },
    {
      question: "What documentation is required for compliance?",
      answer: `You need to maintain comprehensive documentation including:

- Risk assessments
- Security measures implemented
- Incident response procedures
- Vulnerability management process

> [!TIP]
> Keep all documentation version-controlled and easily accessible for audits.`,
      permalink: "#faq-2",
      filename: "documentation.md",
      status: "approved",
      editOnGithubUrl: "#"
    },
    {
      question: "How should I handle vulnerability disclosure?",
      answer: `Establish a clear vulnerability disclosure policy that includes:

> [!IMPORTANT]
> Your disclosure timeline should align with the severity of the vulnerability.

Create a security.txt file and publish contact information for security researchers.`,
      permalink: "#faq-3",
      filename: "vulnerability-disclosure.md",
      status: "draft",
      editOnGithubUrl: "#"
    }
  ],

  // Sample FAQs with different statuses for badge demonstration
  sampleBadgeFaqs: [
    {
      question: "Approved FAQ example",
      status: "approved",
      answerMissing: false,
      guidanceFileNotFound: false
    },
    {
      question: "Draft FAQ example",
      status: "draft",
      answerMissing: false,
      guidanceFileNotFound: false
    },
    {
      question: "Pending guidance FAQ example",
      status: "pending-guidance",
      answerMissing: false,
      guidanceFileNotFound: false
    },
    {
      question: "FAQ with related guidance request example",
      status: "draft",
      answerMissing: false,
      guidanceFileNotFound: false,
      relatedGuidanceRequest: {}
    },
    {
      question: "FAQ with missing answer",
      status: "approved",
      answerMissing: true,
      guidanceFileNotFound: false
    },
    {
      question: "FAQ with missing guidance file",
      status: "pending-guidance",
      answerMissing: false,
      guidanceFileNotFound: true
    }
  ],

  // Read the markdown content file
  markdownContent: fs.readFileSync(
    path.join(__dirname, 'style-guide-content.md'),
    'utf-8'
  ),

  // Source code examples for showing how to use components
  sourceExamples: {
    faqListSimple: `{% set componentData = {
  title: "Getting Started",
  faqs: styleGuideData.sampleListFaqs
} %}
{% include "components/faq-list-simple.njk" %}`,

    faqAccordion: `{% set componentData = {
  title: "Technical Questions",
  description: "Common technical questions about CRA compliance",
  faqs: styleGuideData.sampleAccordionFaqs
} %}
{% include "components/faq-accordion.njk" %}`,

    badges: `{% set faq = {
  status: "approved",
  answerMissing: false,
  guidanceFileNotFound: false
} %}
{% include "components/faq-badges.njk" %}`,

    githubAlerts: `> [!NOTE]
> This is a note callout.

> [!WARNING]
> This is a warning callout.`
  }
};
