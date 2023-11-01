FROM denoland/deno:ubuntu-1.37.2

RUN apt update
RUN apt install sudo
# The port your application listens to.
EXPOSE 80

# The working directory
WORKDIR /app

# Prefer not to run as root.
USER deno

# Give the permission to use /app to the user 'deno'
RUN echo deno:deno | chpasswd
RUN adduser deno sudo
RUN echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
RUN chown -R deno:deno .

# Add contents to the WORKDIR
ADD . .


# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["run", "--allow-net", "main.ts"]