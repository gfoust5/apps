export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const { imageBase64, imageMediaType, notes } = body;

      if (!imageBase64 || !imageMediaType) {
        return new Response(JSON.stringify({ error: 'Missing image data' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const systemPrompt = `You are an experienced houseplant doctor helping a plant owner figure out what's wrong with a plant from a photo and a short note about its recent care.

Respond with JSON in exactly this shape:
{
  "plant": "best guess at plant name, or \\"Unidentified plant\\" if unclear",
  "diagnosisTitle": "short punchy title for what's wrong, e.g. Overwatering stress",
  "severity": "mild" | "moderate" | "urgent",
  "likelyCauses": "1-3 sentences in plain, warm, non-jargony language explaining the most likely cause(s) based on the photo and the notes given",
  "fixSteps": ["short actionable step", "short actionable step", "short actionable step"],
  "watchFor": "1-2 sentences on what sign would mean it's improving, or what sign would mean it's getting worse and needs more urgent action"
}

Ground everything in what's visible in the photo and what the notes say. Be specific and practical, not generic. If the plant looks healthy, say so plainly and keep severity "mild" with reassurance rather than inventing a problem. Keep fixSteps to 3-5 items max, each under 20 words.`;

      // Free tier: no card required. gemini-2.5-flash-lite has the highest
      // free daily request cap if you ever want to swap models below.
      const GEMINI_MODEL = 'gemini-2.5-flash';

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [
              {
                parts: [
                  { text: `Here's the plant. Notes from the owner: "${notes || 'No additional notes given.'}"` },
                  { inline_data: { mime_type: imageMediaType, data: imageBase64 } },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      const data = await geminiResponse.json();

      if (!geminiResponse.ok) {
        return new Response(
          JSON.stringify({ error: data.error?.message || 'Gemini API error' }),
          { status: geminiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textOut) {
        return new Response(JSON.stringify({ error: 'No diagnosis text returned' }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let diagnosis;
      try {
        diagnosis = JSON.parse(textOut);
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Could not parse diagnosis' }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(diagnosis), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
