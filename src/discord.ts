import {Client, Guild, GuildChannel, GuildMember, Role, RoleData, Snowflake, TextChannel, User} from 'discord.js';
import Timeout = NodeJS.Timeout;
import {config} from 'dotenv';

class Action {
    action: string;
    desc: string
    usage: string;

    constructor(action: string, desc: string, usage: string) {
        this.action = action;
        this.desc = desc;
        this.usage = usage;
    }
}

interface BrainTrust {
    [key: string]: BrainGuild | undefined;
}

class BrainGuild {
    guild: Guild;
    role: Role | undefined;
    members: GuildMember[] = [];
    channel: TextChannel | undefined;
    timer: Timeout | undefined;
    registered_prefix: string = '🧠';
    display_tags: boolean = false;
    holder: GuildMember | undefined;

    constructor(guild: Guild) {
        this.guild = guild;
    }

}

export class DiscordService {
    private readonly client: Client;
    private braintrust: BrainTrust = {};

    private readonly actions = {
        set_prefix:{
            action: 'prefix',
            desc: 'Sets a new prefix for commands',
            usage: 'prefix <prefix>'
        } as Action,
        set_channel: {
            action: 'channel',
            desc: 'Sets a new channel to push messages to',
            usage: 'channel <channel>'
        } as Action,
        set_timer: {
            action: 'timer',
            desc: 'Sets the timer between braincell passes',
            usage: 'timer <time (in minutes)>'
        } as Action,
        set_role_name: {
            action: 'role',
            desc: 'Sets the role to pass around',
            usage: 'role <role>'
        } as Action,
        debug: {
            action: 'debug',
            desc: 'dumps some debug info',
            usage: 'debug'
        } as Action,
        opt_out: {
            action: 'opt-out',
            desc: 'Opt yourself out of being passed the braincell',
            usage: 'opt-out'
        } as Action,
        opt_in: {
            action: 'opt-in',
            desc: 'Opt yourself in to being passed the braincell',
            usage: 'opt-in'
        } as Action,
        toggle_tags: {
            action: 'toggle-tags',
            desc: 'Toggles whether or not braincell messages tag the user',
            usage: 'toggle-tags'
        } as Action,
        help: {
            action: 'help',
            desc: 'Sends you a list of commands',
            usage: 'help'
        } as Action
    }

    private readonly braincell_role_name = 'The Braincell';
    private readonly timer_minutes = 10;

    constructor() {
        config();
        this.client = new Client();

        /*
        * On start -
        *   Set the guild (literally first one lol)
        *   Get all the users in the guild
        *   Set cached role by role name
        *       or message saying no role set
        *   Set cached channel by channel name
        *       or grab first channel
        *   Set braincell*/
        this.client.on('ready', async () => {
            await this.setUsername('The Brain Cell');

            const botSetupTasks = this.client.guilds.cache
                .map((g) => g)
                .map(async g => {
                    const bg = new BrainGuild(g);
                    this.braintrust[g.id] = bg;

                    await this.sendMessage(g.id, await this.setChannel(g, 'fishing-channel'));
                    await this.sendMessage(g.id, 'The braincell is ready to be passed around!')
                    const all_members = await g.members.fetch()

                    //Gemme some members that have an empty space where a braincell goes
                    const craniums =  all_members
                        .filter((m) => !m.user.bot)
                        .map((m) => m);

                    bg.members = [
                        ...bg.members,
                        ...craniums
                    ];

                    //Set the default role
                    await this.setRole(g, this.braincell_role_name);

                    if(!bg.role) {
                        bg.role = await this.createRole(g);
                    }
                    await this.braincellTimer(g, this.timer_minutes);
                });
            Promise.all(botSetupTasks);
        });

        /*
        * On Role deleted
        *   Was it our role?
        *       unset the cached role and alert the chanel
        */
        this.client.on("roleDelete", async (role) => {
            const bg = this.braintrust[role.guild.id];
            if(role.id === bg?.role?.id) {
                await this.sendMessage(role.guild.id, `The Braincell role was deleted. Register a new role!`);
            }
        });

        /*
        * On users added to guild
        *       Add to the list of craniums
        */
        this.client.on("guildMemberAdd", async (m) => {
            if(m.partial) await m.fetch();
            await this.add_user(m as GuildMember)
        });

        /*
        * On users removed from guild
        *   check if they're on the list
        *   remove them from the list
        */
        this.client.on("guildMemberRemove", async(del) => {
            if(del.partial) await del.fetch();

            //Purposefully not sending a notice here, if they're out the guild they probs don't care about this dumb bot
            await this.remove_user_guildmember(del as GuildMember, true);
        });

        /*
        * On Channel delete
        *   If it's us
        *       Grab a new channel to use, if none available, do nothing
        */
        this.client.on("channelDelete", async (c) => {
            if(!DiscordService.isGuildChannel(c)) return;
            const bg = this.braintrust[c.guild.id];
            if(c.id === bg?.channel?.id){
                await this.setChannel(c.guild);
            }
        })

        this.client.on("message", async (msg) => {
            if(msg.author.bot) return; //No bots
            if(!msg.guild) return; //No non-guild communication
            const bg = this.braintrust[msg.guild?.id];
            if(!bg) return; //Not a guild we've heard of
            if(!msg.content.startsWith(bg.registered_prefix + ' ')) return; //No prefix

            const params = msg.content.replace(bg.registered_prefix + ' ', '')
                .split(' ');

            const command = params[0];
            switch (command) {
                case this.actions.set_prefix.action:
                    const prefix = params.slice(1).join(' ');
                    await msg.reply(this.setPrefix(msg.guild, prefix));
                    break;
                case this.actions.set_channel.action:
                    if(params.length == 2)
                    {
                        await msg.reply(await this.setChannel(msg.guild, params[1]));
                    } else {
                        await msg.reply(`I didn\'t understand! Usage: \`${bg.registered_prefix} ${this.actions.set_channel.usage} \<channel\>\``)
                    }
                    break;
                case this.actions.set_timer.action:
                    if(params.length == 2 && !isNaN(parseFloat(params[1])))
                    {
                        await msg.reply(`Restarting the timer at ${params[1]} mins, but first lets pass the braincell!`)
                        await this.braincellTimer(msg.guild, parseFloat(params[1]))
                    } else {
                        await this.sendMessage(msg.guild.id, `I didn\'t understand! Usage: \`${bg.registered_prefix} ${this.actions.set_timer.usage} \<channel\>\``)
                    }
                    break;
                case this.actions.set_role_name.action:
                    const role = params.slice(1).join(' ');
                    await msg.reply(await this.setRole(msg.guild, role));
                    break;
                case this.actions.debug.action:
                    const debug_msg = `Channel Name: ${bg.channel?.name}\nRole Name: ${bg.role?.name}\nPrefix: ${bg.registered_prefix}\nTimer length: ${this.timer_minutes}\nHolder: ${bg.holder?.displayName}`
                    await msg.reply(debug_msg)
                    break;
                case this.actions.opt_out.action:
                    await this.remove_user_user(msg.guild, msg.author);
                    break;
                case this.actions.opt_in.action:
                    const gm = await this.fetchGuildMember(msg.author, msg.guild);
                    if(gm) {
                        await this.add_user(gm);
                    } else {
                        await msg.reply(`Can't add users from DMs. Try again in a channel!`)
                    }
                    break;
                case this.actions.toggle_tags.action:
                    bg.display_tags = !bg.display_tags;
                    await msg.reply(`Tags are now ${bg.display_tags ? 'On' : 'Off'}`)
                    break;
                case this.actions.help.action:
                    const dm = await msg.author.createDM();
                    const help = Object.entries(this.actions)
                        .map(([,a]) => `${a.action}: ${a.desc}\n\t\`${bg.registered_prefix} ${a.usage}\``)
                        .join('\n');
                    dm.send(`${help}`);
                    break;
            }
        })

        this.client.login(process.env.DISCORD_TOKEN)
            .catch(err => console.log(`Failed to login, ${err}`));
    }

    async setUsername(username: string){
        await this.client.user?.setUsername(username);
    }

    async setActivity(activity: string){
        await this.client.user?.setActivity(activity);
    }

    async sendMessage(guildId:string, msg: string){
        const bg = this.braintrust[guildId];
        await bg?.channel?.send(msg);
    }

    async fetchGuildMember(u: User, g: Guild | null): Promise<GuildMember|undefined>{
        return g?.members.fetch(u);
    }

    async createRole(bot_guild: Guild, role?: RoleData) :Promise<Role>{
        const newRole = {
                data: role ?? {
                    name: this.braincell_role_name,
                    color: "GOLD",
                    hoist: true,
                    mentionable: true
                },
                reason:'Need a braincell to pass around'
            } as { data?: RoleData; reason?: string }
        return await bot_guild.roles.create(newRole);
    }

    async setRole(guild: Guild, roleName: string): Promise<string> {
        let message = ''
        const bg = this.braintrust[guild.id];
        if(!bg) {
            return `I've never heard of this server before! Weird!`;
        }
        await guild.roles.fetch();
        const roleToSet = guild.roles.cache
            .map((r) => r)
            .find(r => r.name === roleName);
        if(!roleToSet){
            message += `Couldn't find the role \`${roleName}\``;
            if(bg?.role){
                message += `, so I'm gonna keep using \`${bg.role}\``;
            }
        } else {
            bg.role = roleToSet;
            if(!bg.role.hoist){
                await bg?.role.setHoist(true, 'Look upon me and see my works, ye brainless ones')
            }
        }
        return message;
    }

    async addRoleHolder(role:Role, m: GuildMember) {
        await m.roles.add(role);
    }

    async clearRoleHolders(role: Role){
        const losers = role.members
            .map(l => l.roles.remove(role));
        await Promise.all(losers);
    }

    async setChannel(guild: Guild, channel?: string): Promise<string> {
        let response = '';
        const bg = this.braintrust[guild.id];
        if(!bg) {
            return `I've never heard of this server before! Weird!`;
        }
        const textChannels = guild.channels.cache
            .filter(c => c.type === 'text')
            .map(c => c as TextChannel);

        let specified_channel: TextChannel | undefined;
        if(channel){
            specified_channel = textChannels.find(c => c.name === channel)
            if(!specified_channel){
                response = `Couldn't find channel \`${channel}\`, so `;
            }
        }
        specified_channel = specified_channel ?? textChannels[0];

        bg.channel = specified_channel ?? bg.channel;
        response += `I'll respond to <#${bg.channel?.id}>`
        return response;
    }

    setPrefix(guild: Guild, prefix: string): string {
        const bg = this.braintrust[guild.id];
        if(!bg) {
            return `I've never heard of this server before! Weird!`;
        }
        bg.registered_prefix = prefix;
        return `Set to \`${prefix}\``;
    }

    async passTheBraincell(guild: Guild) {
        const bg = this.braintrust[guild.id];
        if(!bg || !bg.role) return;
        const role = bg.role;

        await this.clearRoleHolders(role);

        //Pick a random person to have the braincell and set them up
        const winner = this.whoGetsTheBraincell(guild);
        if(winner){
            bg.holder = winner;
            await this.addRoleHolder(role, winner);
            await this.sendMessage(guild.id,`${this.tagged(winner)} has the braincell!`)
            await this.setActivity(`${winner.nickname ?? winner.displayName} has the braincell!`);
        }
    }

    whoGetsTheBraincell(guild: Guild): GuildMember | undefined {
        const bg = this.braintrust[guild.id];
        if(!bg) return;
        const candidates = bg.members
            .filter(m => m.presence.status === 'online')
        const i = Math.floor(Math.random() * candidates.length);
        return candidates[i];
    }

    async braincellTimer(guild: Guild, minutes:number) {
        const bg = this.braintrust[guild.id];
        if(!bg) {
            return `I've never heard of this server before! Weird!`;
        }
        if (bg.timer) {
            clearInterval(bg.timer)
        }

        await this.passTheBraincell(guild);
        bg.timer = setInterval(
            async () => {
                await this.passTheBraincell(guild);
            },
            minutes*60000
        )
    }

    private static isGuildChannel(c: any): c is GuildChannel {
        return c.guild !== undefined;
    }

    private async remove_user_user(guild: Guild, gm: User, dont_send?: boolean) {
        const bg = this.braintrust[guild.id];
        if(!bg) {
            return `I've never heard of this server before! Weird!`;
        }

        await this.remove_user(bg, gm, dont_send);
    }

    private async remove_user_guildmember(gm: GuildMember, dont_send?: boolean) {
        const bg = this.braintrust[gm.guild.id];
        if(!bg) {
            return `I've never heard of this server before! Weird!`;
        }

        await this.remove_user(bg, gm, dont_send);
    }

    private async remove_user(bg: BrainGuild, gm: GuildMember | User, dont_send?: boolean){
        bg.members = bg.members
            .filter(m => m.id !== gm.id);

        const dm = await gm.createDM();

        if(!dont_send)
        {
            dm.send('No problem, opted out!');
        }

        if(gm.id === bg.holder?.id){
            await this.passTheBraincell(bg.guild);
        }
    }

    private async add_user(m: GuildMember) {
        const bg = this.braintrust[m.guild.id];
        if(!bg) {
            return `I've never heard of this server before! Weird!`;
        }
        bg.members.push(m);
        const dm = await m.createDM();
        dm.send(`You can now get the braincell. Sometimes you\'ll get the braincell, and have extra permissions. To opt out, \`${bg.registered_prefix} ${this.actions.opt_out.usage}\``);
    }

    private tagged(gm: GuildMember){
        const bg = this.braintrust[gm.guild.id];
        if(!bg) {
            return `I've never heard of this server before! Weird!`;
        }
        if(bg.display_tags){
            return `<@${gm.id}>`
        } else {
            return `${gm.displayName}`
        }
    }
}
