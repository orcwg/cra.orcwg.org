# Typography Examples

This is a regular paragraph with **bold text**, *italic text*, and `inline code`. Here's a [link example](#).

## Heading Level 2

### Heading Level 3

## Lists

### Unordered List

- First item with basic text
- Second item with **bold text**
- Third item with *emphasized text*
  - Nested item one
  - Nested item two

### Ordered List

1. First step in the process
2. Second step with `code`
3. Third step with **important** information

## Code Examples

Inline code: `const example = "hello world";`

Block code:
```javascript
function greet(name) {
  return `Hello, ${name}!`;
}

const result = greet("World");
console.log(result);
```

## Blockquotes

> This is a regular blockquote. It should be styled distinctly from alerts and callouts.
> It can span multiple lines and paragraphs.

## GitHub-Style Alerts

> [!NOTE]
> Highlights information that users should take into account, even when skimming.

> [!TIP]
> Optional information to help a user be more successful.

> [!IMPORTANT]
> Crucial information necessary for users to succeed.

> [!WARNING]
> Critical content demanding immediate user attention due to potential risks.

> [!CAUTION]
> Negative potential consequences of an action.

## CRA Hub Specific Alerts

> [!ORC_REC] ORC WG Recommendation 
> ORC Working Group Recommendation Callout.

## Complex Example

Here's a paragraph with a callout:

> [!WARNING]
> This is critical information that demands immediate attention.

Followed by more regular text and a code block:

```javascript
// Example of compliance checking
const checkCompliance = (product) => {
  return product.hasSecurityUpdates &&
         product.hasDocumentation &&
         product.vulnerabilityTracking;
};
```
