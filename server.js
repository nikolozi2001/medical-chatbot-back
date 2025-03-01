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
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const chat = model.startChat({
    history: req.body.history,
  });

  const msg = req.body.message;

  const result = await chat.sendMessage(msg);
  const response = result.response;
  const text = response.text;
  res.send(text)
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
