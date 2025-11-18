const fs = require('fs');
const path = require('path');

module.exports = {
  // Sample children for accordion (includes FAQs and nested list)
  sampleAccordionItems: [
    {
      type: "faq",
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
      type: "list",
      id: "advanced-topics",
      title: "Advanced Security Topics",
      icon: "🔐",
      description: "Deep dive into advanced security practices",
      permalink: "#advanced",
      faqCount: 2,
      listCount: 0,
      countText: "2 faqs"
    },
    {
      type: "faq",
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
    }
  ],

  // Sample data for recursive list component and accordion
  sampleRecursiveList: {
    type: "list",
    title: "Getting Started with CRA",
    icon: "🚀",
    description: "Essential questions about CRA compliance organized by topic",
    permalink: "#getting-started",
    editOnGithubUrl: "#",
    faqCount: 5,
    listCount: 2,
    countText: "5 faqs organised in 2 lists",
    children: [
      {
        type: "faq",
        question: "What is the Cyber Resilience Act?",
        answer: "The Cyber Resilience Act (CRA) is EU legislation aimed at improving cybersecurity of digital products.",
        permalink: "#what-is-cra",
        status: "approved",
        editOnGithubUrl: "#"
      },
      {
        type: "list",
        title: "For Developers",
        icon: "💻",
        description: "Questions specific to software developers",
        permalink: "#for-developers",
        editOnGithubUrl: "#",
        faqCount: 3,
        listCount: 1,
        countText: "3 faqs organised in 1 list",
        children: [
          {
            type: "faq",
            question: "Do I need to comply if I maintain open source?",
            answer: "It depends on your role. Open source stewards have different obligations than manufacturers.",
            permalink: "#oss-compliance",
            status: "approved",
            editOnGithubUrl: "#"
          },
          {
            type: "list",
            title: "Security Best Practices",
            icon: "🔒",
            description: "Detailed security guidelines and requirements",
            permalink: "#security-best-practices",
            editOnGithubUrl: "#",
            faqCount: 2,
            listCount: 0,
            countText: "2 faqs",
            children: [
              {
                type: "faq",
                question: "What security measures are required?",
                answer: "CRA requires secure by design principles, vulnerability handling, and documentation.",
                permalink: "#security-measures",
                status: "draft",
                editOnGithubUrl: "#"
              },
              {
                type: "faq",
                question: "How do I implement vulnerability disclosure?",
                answer: "You need a coordinated vulnerability disclosure process and contact point.",
                permalink: "#vulnerability-disclosure",
                status: "approved",
                editOnGithubUrl: "#"
              }
            ]
          },
          {
            type: "faq",
            question: "What about testing requirements?",
            answer: "Products must undergo security testing before market placement.",
            permalink: "#testing",
            status: "approved",
            editOnGithubUrl: "#"
          }
        ]
      },
      {
        type: "faq",
        question: "When does the CRA take effect?",
        answer: "The CRA comes into force in phases, with full compliance required by December 2027.",
        permalink: "#timeline",
        status: "approved",
        editOnGithubUrl: "#"
      }
    ]
  },

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

  // Sample list card data
  sampleListCard: {
    title: "Advanced Topics",
    icon: "🎓",
    description: "Deep dive into advanced CRA compliance topics",
    permalink: "#advanced",
    faqCount: 7,
    listCount: 2,
    countText: "7 faqs organised in 2 lists"
  },

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
