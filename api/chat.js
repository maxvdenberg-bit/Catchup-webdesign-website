import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let systemPrompt;
try {
  systemPrompt = readFileSync(join(process.cwd(), 'config', 'system-prompt.md'), 'utf-8');
} catch {
  systemPrompt = '';
}

const captureLeadTool = {
  name: 'capture_lead',
  description: 'Capture a qualified lead when the visitor has shared their contact details and project information. Call this after obtaining at least their name and email.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Visitor name' },
      email: { type: 'string', description: 'Visitor email address' },
      projectType: {
        type: 'string',
        enum: ['new-build', 'redesign', 'ecommerce', 'branding', 'other'],
        description: 'Type of project'
      },
      industry: { type: 'string', description: 'Visitor industry or business type' },
      budget: {
        type: 'string',
        enum: ['starter', 'professional', 'premium', 'custom', 'unknown'],
        description: 'Approximate budget tier'
      },
      timeline: {
        type: 'string',
        enum: ['urgent', '1-3months', 'flexible', 'unknown'],
        description: 'Project timeline'
      },
      score: {
        type: 'string',
        enum: ['hot', 'warm', 'cold'],
        description: 'Lead qualification score'
      },
      summary: { type: 'string', description: 'Brief summary of the project and conversation' }
    },
    required: ['name', 'email', 'score', 'summary']
  }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, page } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: [captureLeadTool],
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          res.write(`data: ${JSON.stringify({ type: 'text_start' })}\n\n`);
        } else if (event.content_block.type === 'tool_use') {
          res.write(`data: ${JSON.stringify({ type: 'tool_start', name: event.content_block.name })}\n\n`);
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
        } else if (event.delta.type === 'input_json_delta') {
          res.write(`data: ${JSON.stringify({ type: 'tool_input', json: event.delta.partial_json })}\n\n`);
        }
      } else if (event.type === 'content_block_stop') {
        res.write(`data: ${JSON.stringify({ type: 'block_stop' })}\n\n`);
      } else if (event.type === 'message_delta') {
        if (event.delta.stop_reason === 'tool_use') {
          const finalMessage = await stream.finalMessage();
          const toolUseBlock = finalMessage.content.find(b => b.type === 'tool_use');
          if (toolUseBlock && toolUseBlock.name === 'capture_lead') {
            res.write(`data: ${JSON.stringify({ type: 'lead_captured', lead: toolUseBlock.input })}\n\n`);

            try {
              await submitLead({ ...toolUseBlock.input, page, timestamp: new Date().toISOString() });
            } catch (e) {
              console.error('Lead submission failed:', e);
            }

            const followupMessages = [
              ...messages.map(m => ({ role: m.role, content: m.content })),
              { role: 'assistant', content: finalMessage.content },
              {
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: 'Lead captured successfully. Confirm to the visitor that the team will be in touch within 24 hours.'
                }]
              }
            ];

            const followupStream = client.messages.stream({
              model: 'claude-sonnet-4-6',
              max_tokens: 256,
              system: systemPrompt,
              tools: [captureLeadTool],
              messages: followupMessages
            });

            for await (const followupEvent of followupStream) {
              if (followupEvent.type === 'content_block_delta' && followupEvent.delta.type === 'text_delta') {
                res.write(`data: ${JSON.stringify({ type: 'text', text: followupEvent.delta.text })}\n\n`);
              }
            }
          }
        }
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Chat API error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function submitLead(leadData) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadData)
    });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.NOTIFICATION_EMAIL;
  if (resendKey && notifyEmail) {
    const scoreEmoji = { hot: '🔥', warm: '🌤️', cold: '❄️' }[leadData.score] || '';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: 'Catch Up Leads <leads@catchupwebdesign.com.au>',
        to: notifyEmail,
        subject: `${scoreEmoji} New ${esc(leadData.score)} lead — ${esc(leadData.name)}`,
        html: `
          <h2>New Lead from Website Chatbot</h2>
          <table style="border-collapse:collapse;width:100%;max-width:500px">
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Name</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(leadData.name)}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Email</td><td style="padding:8px;border-bottom:1px solid #eee"><a href="mailto:${encodeURIComponent(leadData.email)}">${esc(leadData.email)}</a></td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Score</td><td style="padding:8px;border-bottom:1px solid #eee">${scoreEmoji} ${esc(leadData.score).toUpperCase()}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Project</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(leadData.projectType || 'Not specified')}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Industry</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(leadData.industry || 'Not specified')}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Budget</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(leadData.budget || 'Unknown')}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Timeline</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(leadData.timeline || 'Unknown')}</td></tr>
            <tr><td style="padding:8px;font-weight:bold">Summary</td><td style="padding:8px">${esc(leadData.summary)}</td></tr>
          </table>
          <p style="margin-top:16px;color:#666;font-size:13px">Captured from: ${esc(leadData.page || 'Unknown page')} at ${esc(leadData.timestamp)}</p>
        `
      })
    });
  }
}
