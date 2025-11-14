const fs = require('fs');
const path = require('path');

module.exports = {
  // Sample items for accordion (includes FAQs and nested list)
  sampleAccordionItems: [
    {
      type: "faq",
      data: {
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
      }
    },
    {
      type: "list",
      data: {
        id: "advanced-topics",
        title: "Advanced Security Topics",
        icon: "🔐",
        description: "Deep dive into advanced security practices",
        permalink: "#advanced",
        faqCount: 2,
        listCount: 0
      }
    },
    {
      type: "faq",
      data: {
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
    }
  ],

  // Sample data for recursive list component
  sampleRecursiveList: {
    title: "Getting Started with CRA",
    icon: "🚀",
    description: "Essential questions about CRA compliance organized by topic",
    items: [
      {
        type: "faq",
        data: {
          question: "What is the Cyber Resilience Act?",
          permalink: "#what-is-cra",
          status: "approved",
          editOnGithubUrl: "#"
        }
      },
      {
        type: "list",
        data: {
          title: "For Developers",
          icon: "💻",
          description: "Questions specific to software developers",
          permalink: "#for-developers",
          faqCount: 2,
          listCount: 1,
          items: [
            {
              type: "faq",
              data: {
                question: "Do I need to comply if I maintain open source?",
                permalink: "#oss-compliance",
                status: "approved",
                editOnGithubUrl: "#"
              }
            },
            {
              type: "list",
              data: {
                title: "Security Best Practices",
                icon: "🔒",
                description: "Detailed security guidelines and requirements",
                permalink: "#security-best-practices",
                faqCount: 2,
                listCount: 0,
                items: [
                  {
                    type: "faq",
                    data: {
                      question: "What security measures are required?",
                      permalink: "#security-measures",
                      status: "draft",
                      editOnGithubUrl: "#"
                    }
                  },
                  {
                    type: "faq",
                    data: {
                      question: "How do I implement vulnerability disclosure?",
                      permalink: "#vulnerability-disclosure",
                      status: "approved",
                      editOnGithubUrl: "#"
                    }
                  }
                ]
              }
            },
            {
              type: "faq",
              data: {
                question: "What about testing requirements?",
                permalink: "#testing",
                status: "approved",
                editOnGithubUrl: "#"
              }
            }
          ]
        }
      },
      {
        type: "faq",
        data: {
          question: "When does the CRA take effect?",
          permalink: "#timeline",
          status: "approved",
          editOnGithubUrl: "#"
        }
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
