# How to use an Agent

Replace {AgentName} with the name of the agent you want to use.

1. Move the contents of `Euterpe/agent-examples/{AgentName}/public/resources` to `Euterpe/public/resources`. If there is no `public` folder inside the agent's directory, you can skip this step.
2. Delete all the files in `Euterpe/src/agent/` and replace them with the files found in `Euterpe/agent-examples/{AgentName}/agent`.