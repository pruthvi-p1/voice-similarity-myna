# AI_PROMPTS.md

## 1

**Prompt**

The comapre endpoint keeps failing when audio format isn’t WAV and I’m getting errors on librose.load().

**Reason**

Used this to resolve format conversion issues when chrome is used for audio recording.

---

## 2

**Prompt**

UI currently shows similarity percent by simply multiplying the cosine similarity score recieved from endpoint into 100. Can you update this calcaution to use angular similarity instead.

**Reason**

Used this to switch to a proper display mapping and copy that match what cosine means, so the table didn’t over-claim percent.

---

## 3

**Prompt**

I want to add a progress bar of sorts to visually show most similar to least similar. use the lowest to highest similarity as the bar scale, not 0–100.

**Reason**

Added this UI improvement allow users to easily distinguish between the most similar sample to least using ordering in tabular structure and 
