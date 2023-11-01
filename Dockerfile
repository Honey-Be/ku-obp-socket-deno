FROM denoland/deno:ubuntu-1.37.2

RUN apt update
RUN apt install sudo
# The port your application listens to.
EXPOSE 80

# Prefer not to run as root.
USER deno

RUN echo "deno:deno" | chpasswd && adduser deno sudo echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# The working directory
WORKDIR /app

RUN sudo chown -R deno:deno /app


# Add contents to the WORKDIR
ADD . .


# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["run", "--allow-net", "main.ts"]