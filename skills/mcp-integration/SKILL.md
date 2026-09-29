---
name: mcp-integration
description: Use MCP servers (context7, shadcn-ui, playwright) for documentation lookup, UI components, browser automation, and web research whenever tasks can benefit.
---

# MCP Server Integration

## Quick Start Workflow

When starting any task that could use MCP servers, follow this sequence:

1. **Identify task type** - Determine which MCP servers are relevant
2. **Check MCP availability** - Verify which MCP servers are accessible
3. **Use MCP server first** - Prefer MCP tools over manual approaches
4. **Fallback gracefully** - If MCP unavailable, use alternative methods
5. **Document usage** - Note which MCP servers were used and why

## Available MCP Servers

### 1. context7 MCP

**Purpose:** Intelligent context retrieval and web search

**When to use:**
- Researching technical documentation
- Looking up API references
- Finding code examples
- Retrieving current best practices
- Searching Stack Overflow or GitHub
- Understanding error messages
- Learning about new technologies

**Activation triggers:**
- "research"
- "look up"
- "find documentation"
- "search for"
- "what is the best way to"
- "how do I"
- "error message"

**Example usage:**
```
# Instead of: manual web search and reading
# Use: context7 MCP to retrieve relevant documentation

User: "How do I implement OAuth2 in Next.js?"
Assistant: *Uses context7 MCP to retrieve Next.js OAuth2 documentation and examples*
```

### 2. shadcn-ui MCP

**Purpose:** Access shadcn/ui component library and implementation guidance

**When to use:**
- Adding UI components to React/Next.js projects
- Implementing design systems
- Building forms, dialogs, dropdowns, etc.
- Using Radix UI primitives
- Setting up component libraries
- Styling with Tailwind CSS

**Activation triggers:**
- "add a button component"
- "create a form"
- "implement a dialog"
- "use shadcn"
- "UI component"
- "design system"
- "Radix UI"

**Example usage:**
```
# Instead of: copying component code from website
# Use: shadcn-ui MCP to get latest component implementation

User: "Add a dropdown menu to the navigation"
Assistant: *Uses shadcn-ui MCP to retrieve dropdown menu component*
```

### 3. playwright MCP

**Purpose:** Browser automation and end-to-end testing

**When to use:**
- Writing e2e tests
- Browser automation tasks
- Testing user flows
- Debugging web applications
- Scraping dynamic content
- Capturing screenshots
- Generating test reports

**Activation triggers:**
- "write a test for"
- "automate browser"
- "test user flow"
- "e2e test"
- "screenshot"
- "browser automation"
- "Playwright test"

**Example usage:**
```
# Instead of: manual testing or basic test scripts
# Use: playwright MCP for enhanced test generation

User: "Create a test for the login flow"
Assistant: *Uses playwright MCP to generate comprehensive test*
```

## Standard Guidelines

### MCP-First Approach

When applicable, always consider MCP servers before manual approaches:

```markdown
**Task**: Research Next.js best practices
**MCP Approach**: Use context7 to retrieve latest documentation
**Manual Approach**: Search web, read multiple articles, synthesize
**Choice**: MCP (faster, more reliable, current)

**Task**: Add dialog component
**MCP Approach**: Use shadcn-ui to get component implementation
**Manual Approach**: Copy from shadcn website or write custom
**Choice**: MCP (consistent, tested, up-to-date)

**Task**: Test checkout flow
**MCP Approach**: Use playwright to generate comprehensive test
**Manual Approach**: Write test manually with basic assertions
**Choice**: MCP (more thorough, better practices)
```

### MCP Availability Check

```bash
# Check which MCP servers are available
# This is typically shown in Claude Code capabilities

# If MCP not available, inform user:
echo "Note: [MCP-NAME] is not currently available."
echo "Using alternative approach: [FALLBACK-METHOD]"
```

## Common Patterns

### Pattern 1: Web Research with context7

```markdown
**Scenario**: User asks technical question

1. Identify if question needs external knowledge
2. Use context7 MCP to search relevant sources
3. Synthesize retrieved information
4. Provide answer with sources
5. Apply knowledge to user's specific context

**Example**:
User: "What's the best way to handle authentication in Next.js 14?"

Response:
- Use context7 MCP to retrieve:
  - Next.js 14 authentication patterns
  - NextAuth.js documentation
  - App Router authentication examples
- Synthesize and provide tailored recommendation
```

### Pattern 2: UI Component Implementation with shadcn-ui

```markdown
**Scenario**: User needs to add UI component

1. Identify component type (button, form, dialog, etc.)
2. Use shadcn-ui MCP to retrieve component
3. Adapt component to user's project structure
4. Add necessary imports and dependencies
5. Provide usage examples

**Example**:
User: "Add a confirmation dialog for delete actions"

Response:
- Use shadcn-ui MCP to get AlertDialog component
- Adapt to project's file structure
- Include TypeScript types if needed
- Add example implementation
```

### Pattern 3: Test Automation with playwright

```markdown
**Scenario**: User needs to test a feature

1. Understand the feature and user flow
2. Use playwright MCP to generate test structure
3. Add specific assertions for the feature
4. Include error cases and edge cases
5. Provide test running instructions

**Example**:
User: "Test the shopping cart functionality"

Response:
- Use playwright MCP to generate test suite
- Add cart-specific assertions
- Include quantity changes, removal, and checkout
- Provide setup and run instructions
```

## Edge Cases

### Case 1: MCP Server Unavailable

If an MCP server is not available:

```markdown
**Approach**:
1. Acknowledge the limitation
2. Explain what would have been possible with MCP
3. Provide best alternative approach
4. Complete task using available tools

**Example**:
"Note: context7 MCP is not available, so I'll provide guidance based on
my training knowledge. For the most current information, you may want to
check [official documentation link]."
```

### Case 2: Multiple MCPs Applicable

If multiple MCPs could be used:

```markdown
**Approach**:
1. Identify all applicable MCPs
2. Determine primary and secondary usage
3. Use them in logical sequence
4. Explain the workflow

**Example**:
Task: "Build a contact form with validation"
- Use context7 to research form validation best practices
- Use shadcn-ui to get form components
- Use playwright to create form submission tests
```

### Case 3: MCP Returns Incomplete Information

If MCP doesn't provide full answer:

```markdown
**Approach**:
1. Use what MCP provides as foundation
2. Supplement with training knowledge
3. Acknowledge any gaps
4. Suggest where user can find more info

**Example**:
"context7 provided [specific info], and based on common patterns,
you should also consider [additional guidance]. For more details,
see [documentation link]."
```

### Case 4: Project Doesn't Support MCP Suggestion

If MCP suggests something incompatible:

```markdown
**Approach**:
1. Acknowledge the MCP suggestion
2. Explain project-specific constraints
3. Adapt suggestion to project needs
4. Provide modified implementation

**Example**:
"shadcn-ui uses Tailwind CSS, but your project uses CSS Modules.
Here's how to adapt the component structure to your setup..."
```

## Integration Priorities

### When Multiple Tools Are Available

**Priority Order:**
1. **MCP servers** (when applicable and available)
2. **Built-in Claude Code tools** (Read, Write, Bash, etc.)
3. **Manual implementation** (when no better option exists)

**Reasoning:**
- MCPs provide specialized, up-to-date capabilities
- Built-in tools are reliable and always available
- Manual implementation is fallback when needed

## Knowledge Base

### MCP Server Capabilities Matrix

| Task Type | Primary MCP | Secondary MCP | Fallback |
|-----------|-------------|---------------|----------|
| Research | context7 | - | Training knowledge |
| UI Components | shadcn-ui | - | Manual implementation |
| E2E Testing | playwright | - | Manual test writing |
| Documentation | context7 | - | Read files directly |
| Browser Tasks | playwright | - | Manual instructions |

### When NOT to Use MCPs

- **File operations**: Use Read, Write, Edit tools
- **Local commands**: Use Bash tool
- **Project-specific code**: Use direct implementation
- **Simple questions**: Answer from training knowledge
- **Math/logic**: Direct computation

## Critical Rules

### Always Prefer MCPs When Applicable

```markdown
# CORRECT approach
User: "How do I use React hooks?"
Response: *Uses context7 to retrieve latest React hooks documentation*

# INCORRECT approach
User: "How do I use React hooks?"
Response: *Provides answer only from training data without checking current docs*
```

### Explain MCP Usage to Users

```markdown
# GOOD - Transparent about MCP usage
"I'm using context7 MCP to retrieve the latest Next.js documentation
on this topic..."

# BETTER - Explain why MCP is beneficial
"I'll use context7 MCP to get the most current Next.js 14 patterns,
as the framework has evolved significantly..."
```

### Fallback Gracefully

```markdown
# GOOD - Clear fallback
"Since [MCP] isn't available, I'll [alternative approach]..."

# BETTER - Explain limitations
"Without [MCP], I can provide guidance based on my training knowledge
from my training data, but recommend checking [source] for the latest updates."
```

## Quick Reference

### MCP Selection Guide

**Need to research or look something up?**
→ Use **context7**

**Need to add UI components (React/Next.js)?**
→ Use **shadcn-ui**

**Need to test in browser or automate browser tasks?**
→ Use **playwright**

### Activation Keywords

**context7:**
- research, look up, find, documentation, best practices, how to, what is, search

**shadcn-ui:**
- component, UI, form, button, dialog, dropdown, design system, shadcn, Radix

**playwright:**
- test, e2e, automation, browser, screenshot, user flow, Playwright

### Integration Commands

```bash
# These MCPs are configured in your MCP client's settings
# and accessed through Claude Code's MCP integration

# No manual commands needed - Claude Code handles MCP communication
```

## Success Criteria

- [ ] MCP servers are considered for every applicable task
- [ ] Users are informed when MCPs are used
- [ ] Fallback approaches are provided when MCPs unavailable
- [ ] MCP-retrieved information is current and accurate
- [ ] Task efficiency improves with MCP usage
