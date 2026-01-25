AI Health Coach:


- Purpose : Weight Loss Health Coach
- Age Range : 24 - 45
- Goal : Lose fat
- Problem : No consistency in maintaining calories and No workouts
- Why AI : Simple Personalized Guidance


What this RAG application helps with:

- What should i eat?
- How should i exercise?
- Is this habit good?
- What does this health report mean?

My RAG system will retrive trusted health content and generate personalized coaching responses.

Tech Stack:

Frontend - Next.js, Tailwind CSS
Backend - Python
AI LLM - OpenAI
RAG - Langchain
Vector DB - Pinecone
Database - PostgreSQL


Architecture:

User Query -> UI -> API -> Tokens -> Embedding -> Prompt -> LLM + Vector DB -> Retrieved Docs -> AI Response -> UI


