import {Client, Guild, GuildChannel, GuildMember, Role, RoleData, TextChannel, User} from 'discord.js';
import Timeout = NodeJS.Timeout;
import {config} from 'dotenv';

export class DiscordService {
    private readonly client: Client;
    private braincell_role: Role | undefined;
    private members: GuildMember[] = [];
    private braincell_channel: TextChannel | undefined;
    private timer: Timeout | undefined;
    private registered_prefix: string = '🧠'
    private display_tags: boolean = true;
    private holder: GuildMember | undefined;

    private readonly set_prefix = 'prefix';
    private readonly set_channel = 'channel';
    private readonly set_timer = 'timer';
    private readonly set_role_name = 'role';
    private readonly debug = 'debug';
    private readonly opt_out = 'opt-out';
    private readonly opt_in = 'opt-in';
    private readonly toggle_tags = 'toggle-tags';
    private readonly braincell_role_name = 'the_braincell';
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
            await this.setActivity('Passing around the brain cell!');

            const bot_guild = this.client.guilds.cache.map((g) => g)[0];
            await this.sendMessage(await this.setChannel(bot_guild, 'braincell'));
            await this.sendMessage('The braincell is ready to be passed around!')
            const all_members = await bot_guild.members.fetch()

            //Gemme some members that have an empty space where a braincell goes
            const craniums =  all_members
                .filter((m) => !m.user.bot)
                .map((m) => m);

            this.members = [
                ...this.members,
                ...craniums
            ];

            //Set the default role
            await this.setRole(bot_guild, this.braincell_role_name);

            if(!this.braincell_role) {
                await this.createRole(bot_guild);
            }
            await this.braincellTimer(this.timer_minutes);
        });

        /*
        * On Role deleted
        *   Was it our role?
        *       unset the cached role and alert the chanel
        */
        this.client.on("roleDelete", async (role) => {
            if(role.id === this.braincell_role?.id) {
                await this.sendMessage(`The Braincell role was deleted. \`${null}\` to register a new role!`);
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
            await this.remove_user(del as GuildMember, true);
        });

        /*
        * On Channel delete
        *   If it's us
        *       Grab a new channel to use, if none available, do nothing
        */
        this.client.on("channelDelete", async (c) => {
            if(!DiscordService.isGuildChannel(c)) return;
            if(c.id === this.braincell_channel?.id){
                await this.setChannel(c.guild);
            }
        })

        this.client.on("message", async (msg) => {
            if(msg.author.bot) return; //No bots
            if(!msg.content.startsWith(this.registered_prefix + ' ')) return; //No prefix

            const params = msg.content.replace(this.registered_prefix + ' ', '')
                .split(' ');

            const command = params[0];
            switch (command) {
                case this.set_prefix:
                    const prefix = params.slice(1).join(' ');
                    await msg.reply(this.setPrefix(prefix));
                    break;
                case this.set_channel:
                    if(params.length == 2)
                    {
                        if(!msg.guild){
                            await msg.reply('Can\'t set channel from DMs, try again in a channel!')
                        } else {
                            await msg.reply(await this.setChannel(msg.guild, params[1]));
                        }
                    } else {
                        await msg.reply(`I didn\'t understand! Usage: \`${this.registered_prefix} ${this.set_channel} \<channel\>\``)
                    }
                    break;
                case this.set_timer:
                    if(params.length == 2 && !isNaN(parseFloat(params[1])))
                    {
                        await msg.reply(`Restarting the timer at ${params[1]} mins, but first lets pass the braincell!`)
                        await this.braincellTimer(parseFloat(params[1]))
                    } else {
                        await this.sendMessage(`I didn\'t understand! Usage: \`${this.registered_prefix} ${this.set_timer} \<channel\>\``)
                    }
                    break;
                case this.set_role_name:
                    const role = params.slice(1).join(' ');
                    if(!msg.guild){
                        await msg.reply('Can\'t set role from DMs, try again in a channel!')
                    } else {
                        await msg.reply(await this.setRole(msg.guild, role));
                    }
                    break;
                case this.debug:
                    const debug_msg = `Channel Name: ${this.braincell_channel?.name}\nRole Name: ${this.braincell_role?.name}\nPrefix: ${this.registered_prefix}\nTimer length: ${this.timer_minutes}\nHolder: ${this.holder}`
                    await msg.reply(debug_msg)
                    break;
                case this.opt_out:
                    await this.remove_user(msg.author);
                    break;
                case this.opt_in:
                    const gm = await this.fetchGuildMember(msg.author, msg.guild);
                    if(gm) {
                        await this.add_user(gm);
                    } else {
                        await msg.reply(`Can't add users from DMs. Try again in a channel!`)
                    }
                    break;
                case this.toggle_tags:
                    this.display_tags = !this.display_tags;
                    await msg.reply(`Tags are now ${this.display_tags ? 'On' : 'Off'}`)
                    break
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

    async sendMessage(msg: string){
        await this.braincell_channel?.send(msg);
    }

    async fetchGuildMember(u: User, g: Guild | null): Promise<GuildMember|undefined>{
        return g?.members.fetch(u);
    }

    async createRole(bot_guild: Guild, role?: RoleData) {
        const newRole = {
                data: role ?? {
                    name: this.braincell_role_name,
                    color: "GOLD"
                },
                reason:'Need a braincell to pass around'
            } as { data?: RoleData; reason?: string }
        this.braincell_role = await bot_guild.roles.create(newRole);
    }

    async setRole(guild: Guild, roleName: string): Promise<string> {
        let message = ''
        await guild.roles.fetch();
        const roleToSet = guild.roles.cache
            .map((r) => r)
            .find(r => r.name === roleName);
        if(!roleToSet){
            message += `Couldn't find the role \`${roleName}\``;
            if(this.braincell_role){
                message += `, so I'm gonna keep using \`${this.braincell_role}\``;
            }
        } else {
            this.braincell_role = roleToSet;
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
        const textChannels = guild.channels.cache
            .filter(c => c.type === 'text')
            .map(c => c as TextChannel);

        let specified_channel: TextChannel | undefined;
        if(channel){
            specified_channel = textChannels.find(c => c.name === channel)
            response = `Couldn't find channel \`${channel}\`, so `;
        }
        specified_channel = specified_channel ?? textChannels[0];

        this.braincell_channel = specified_channel ?? this.braincell_channel;
        response += `I'll respond to <#${this.braincell_channel?.id}>`
        return response;
    }

    setPrefix(prefix: string): string {
        this.registered_prefix = prefix;
        return `Set to \`${prefix}\``;
    }

    async passTheBraincell() {
        if(!this.braincell_role) return;
        const role = this.braincell_role;

        await this.clearRoleHolders(role);

        //Pick a random person to have the braincell and set them up
        const winner = this.whoGetsTheBraincell();
        if(winner){
            this.holder = winner;
            await this.addRoleHolder(role, winner);
            await this.sendMessage(`${this.tagged(winner)} has the braincell!`)
        }
    }

    whoGetsTheBraincell(): GuildMember | undefined {
        const i = Math.floor(Math.random() * this.members.length);
        return this.members[i];
    }

    async braincellTimer(minutes:number) {
        if (this.timer) {
            clearInterval(this.timer)
        }

        await this.passTheBraincell();
        this.timer = setInterval(
            async () => {
                await this.passTheBraincell();
            },
            minutes*60000
        )
    }

    private static isGuildChannel(c: any): c is GuildChannel {
        return c.guild !== undefined;
    }

    private async remove_user(u: GuildMember | User, dont_send?: boolean) {
        this.members = this.members
            .filter(m => m.id !== u.id);

        const dm = await u.createDM();

        if(!dont_send)
        {
            dm.send('No problem, opted out!');
        }

        if(u.id === this.holder?.id){
            await this.passTheBraincell();
        }
    }

    private async add_user(m: GuildMember) {
        this.members.push(m);
        const dm = await m.createDM();
        dm.send(`You can now get the braincell. Sometimes you\'ll get the braincell, and have extra permissions. To opt out, \`${this.registered_prefix} ${this.opt_out}\``);
    }

    private tagged(gm: GuildMember){
        if(this.display_tags){
            return `<@${gm.id}>`
        } else {
            return `${gm.displayName}`
        }
    }
}
