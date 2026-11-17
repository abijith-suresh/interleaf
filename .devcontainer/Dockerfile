FROM node:24-slim

# Install essential packages
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Install Bun (keep in sync with mise.toml)
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.1"

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Set up non-root user
RUN useradd -m -s /bin/bash nodeuser \
    && usermod -aG sudo nodeuser \
    && echo "nodeuser ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/nodeuser

USER nodeuser
WORKDIR /workspace

# Add Bun to PATH
ENV BUN_INSTALL="/home/nodeuser/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Expose port for Astro dev server
EXPOSE 4321

# Default command
CMD ["bash"]
