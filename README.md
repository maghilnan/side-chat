# SideChat

SideChat is a Chrome extension for ChatGPT that lets you open a separate, ephemeral side conversation without cluttering your main thread.

It captures context from the active ChatGPT tab, lets you ask a tangent question in a side panel, and optionally turns that side discussion into a short summary you can paste back into the main chat.

## The Problem This Project Solves

When you're working through something in ChatGPT, you often need to ask side questions:

- "Wait, can you explain just this one term?"
- "What are the tradeoffs here?"
- "Can you check this assumption before I continue?"

Those detours are useful, but they also pollute the main conversation. The result is a noisier thread, weaker context, and a harder time returning to the original task.

SideChat solves that by giving you a scratch-space beside ChatGPT:

- your main conversation stays clean
- the side question still has access to relevant context
- you can bring back only the useful conclusion as a short summary

## What SideChat Does

<div align="center">
  <video src="https://github.com/user-attachments/assets/e27bf673-7ece-4be5-8bdd-46037cc3eed1" controls>
    Your browser does not support the video tag.
  </video>
</div>


- Reads the current ChatGPT conversation from the page
- Opens a Chrome side panel for an isolated side conversation
- Sends your side question to OpenAI or Anthropic using your own API key
- Keeps the side chat separate from the main ChatGPT thread
- Watches for changes in the main chat and lets you refresh captured context
- Generates a concise or detailed summary of the side conversation
- Pastes that summary back into the ChatGPT input when you want it

## How It Works

SideChat is intentionally lightweight:

- no build step
- no dependencies
- no backend
- plain JavaScript Chrome extension using Manifest V3

The extension runs only on `chatgpt.com` and `chat.openai.com`.

## Install the Extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project folder: `/Users/maghilnan/Projects/side-chat`

After making code changes, refresh the extension from the extensions page.

## Set It Up

Before SideChat can answer anything, add at least one API key.

1. Open the extension settings page
2. Add an API key for either:
   - OpenAI
   - Anthropic
3. Optionally choose a default model
4. Optionally adjust:
   - max context message pairs
   - summary style (`concise` or `detailed`)

Your API keys are stored locally in Chrome storage and sent only to the selected provider API.

## How to Use the Chrome Extension

### 1. Open ChatGPT

Go to `https://chatgpt.com` or `https://chat.openai.com` and open a conversation.

### 2. Open SideChat

Use either of these:

- click the SideChat toolbar icon to open the Chrome side panel
- select text in ChatGPT and use `Ask SideChat`
- use the context menu on selected text

### 3. Ask a Side Question

Type a question into the side panel such as:

- "Explain that last answer more simply"
- "What are the risks of this approach?"
- "Compare option A and B before I continue"

SideChat includes the captured main-chat context so the side response stays relevant.

### 4. Refresh Context if the Main Chat Changes

If new messages appear in the main ChatGPT conversation while the panel is open, SideChat shows a refresh prompt so you can pull in the latest context.

### 5. Add the Result Back to the Main Chat

When the side conversation is useful, click `Add Summary`.

SideChat will generate a short note in the format:

`SideChat Summary: ... Do not respond back.`

You can then:

- paste it into ChatGPT
- copy it manually
- cancel it

This lets you bring back just the conclusion instead of the entire tangent.

## Expected Workflow

1. Start a main conversation in ChatGPT
2. Notice a tangent or clarification you want to explore
3. Ask that question in SideChat instead of the main thread
4. Keep iterating in the side panel until you get what you need
5. Inject only the summary back into the main chat if it helps

## Project Structure

- `background.js` - service worker for routing, panel lifecycle, and API streaming
- `content-script.js` - reads ChatGPT DOM, detects updates, and injects `Ask SideChat`
- `sidepanel/sidepanel.js` - main side panel UI and conversation flow
- `sidepanel/settings.js` - inline side panel settings UI
- `options/options.js` - full settings page for keys and preferences
- `utils/dom-reader.js` - extracts context from the ChatGPT page
- `utils/api.js` - provider API wrappers and streaming helpers
- `utils/summarizer.js` - prompt builders for side chat summaries

## Notes

- SideChat is designed to be ephemeral, not a long-term chat archive
- Side-chat state is session-based and tied to the browser tab
- There is no project backend; responses come directly from the configured AI provider
- The extension currently supports ChatGPT pages only

## Source Notes

This README was written primarily from `.claude/CLAUDE.md` and the current extension code. An `AGENTS.md` file was requested but does not appear to exist in this repository.
