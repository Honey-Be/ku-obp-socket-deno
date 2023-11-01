FROM denoland/deno:ubuntu-1.37.2

# The port your application listens to.
EXPOSE 80

# The working directory
WORKDIR /app

# Give the permission to use /app to the user 'deno'
USER root
RUN chown -R deno:deno .


# Prefer not to run as root.
USER deno

# Add contents to the WORKDIR
ADD . .

# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["run", "--allow-net", "main.ts"]