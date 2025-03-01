const PORT = process.env.PORT || 8000;
const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());
require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEN_AI_KEY);

app.post("/chat", async (req, res) => {
  try {
    console.log("Received /chat request with body:", req.body);

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const chat = model.startChat({
      history: req.body.history,
    });

    const msg = req.body.message;

    const result = await chat.sendMessage(msg);
    console.log("Result object:", result);

    const response = await result.response;
    console.log("Response object:", response);

    const text = response.candidates[0].content.parts.map(part => part.text).join(" ");
    console.log("Generated response text:", text);

    res.json({ text });
  } catch (error) {
    console.error("Error handling /chat request:", error);
    if (error.response) {
      console.error("Response data:", error.response.data);
      console.error("Response status:", error.response.status);
      console.error("Response headers:", error.response.headers);
    }
    res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
