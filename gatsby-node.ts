import { GatsbyNode } from "gatsby"
import * as path from "path"
import { promisify } from "util"
import { readFile } from "fs/promises"
import * as globby from "globby"
import * as frontmatterParser from "parser-front-matter"
import { sortLibs } from "./scripts/sort-libraries"

const parse$ = promisify(frontmatterParser.parse)

export const createSchemaCustomization: GatsbyNode["createSchemaCustomization"] =
  async ({ actions }) => {
    const gql = String.raw
    const { createTypes } = actions

    createTypes(gql`
      type BlogPost implements Node @childOf(types: ["MarkdownRemark"]) {
        postId: String!
        title: String!
        tags: [String!]!
        date: Date! @dateformat(formatString: "YYYY-MM-DD")
        authors: [String!]!
        guestBio: String
        remark: MarkdownRemark! @link # backlink to the parent
      }
    `)
  }

// Transform nodes, each of logic inside here can be extracted to a separated plugin later.
export const onCreateNode: GatsbyNode["onCreateNode"] = async ({
  reporter,
  node,
  actions,
  createNodeId,
  createContentDigest,
}) => {
  const { createNode, createParentChildLink } = actions

  // Derive content nodes from remark nodes
  if (
    node.internal.type === "MarkdownRemark" &&
    node.frontmatter.layout === "blog"
  ) {
    const nodeId = createNodeId(`${node.id} >>> BlogPost`)

    const { permalink } = node.frontmatter
    if (!permalink?.startsWith("/blog/")) {
      reporter.panicOnBuild(`${permalink} is not valid permalink for blog post`)
      return
    }

    // It contains a kind of transform logic. However, those logics can be extracted to resolvers into ahead of sourcing (createTypes)
    const blogPostContent = {
      id: nodeId,
      postId: permalink.replace("/blog/", "").replace(/\/$/, ""),
      title: node.frontmatter.title,
      tags: node.frontmatter.tags ?? [],
      date: node.frontmatter.date,
      authors: (node.frontmatter.byline ?? "")
        .split(",")
        .map(name => name.trim())
        .filter(Boolean),
      guestBio: node.frontmatter.guestBio ?? null,
    }

    createNode({
      ...blogPostContent,
      remark: node.id,
      parent: node.id,
      children: [],
      internal: {
        type: "BlogPost",
        contentDigest: createContentDigest(blogPostContent),
      },
    })

    createParentChildLink({
      parent: node,
      child: blogPostContent,
    })
  }
}

export const onCreatePage: GatsbyNode["onCreatePage"] = async ({
  page,
  actions,
}) => {
  // trying to refactor code to be "the Gatsby way".
  // from the paths on ready, ignores a bunch of existing custom logic below.
  if (page.path.startsWith("/blog")) {
    return
  }
  if (page.path.startsWith("/tags")) {
    return
  }

  const { createPage, deletePage } = actions
  deletePage(page)
  let context = {
    ...page.context,
    sourcePath: path.relative(__dirname, page.path),
  }
  if (page.path === "/code" || page.path === "/code/") {
    const markdownFilePaths = await globby("src/content/code/**/*.md")
    const codeData: any = {}
    const slugMap = require("./src/content/code/slug-map.json")
    await Promise.all(
      markdownFilePaths.map(async markdownFilePath => {
        const markdownFileContent = await readFile(markdownFilePath, "utf-8")
        let {
          data: { name, description, url, github, npm, gem },
          content: howto,
        } = await parse$(markdownFileContent)
        howto = howto.trim()
        const pathArr = markdownFilePath.split("/")
        if (markdownFilePath.includes("language-support")) {
          const languageSupportDirIndex = pathArr.indexOf("language-support")
          const languageNameSlugIndex = languageSupportDirIndex + 1
          const languageNameSlug = pathArr[languageNameSlugIndex]
          const languageName = slugMap[languageNameSlug]
          codeData.Languages ||= {}
          codeData.Languages[languageName] ||= {}

          const categoryNameSlugIndex = languageSupportDirIndex + 2
          const categoryNameSlug = pathArr[categoryNameSlugIndex]
          const categoryName = slugMap[categoryNameSlug]
          codeData.Languages[languageName][categoryName] ||= []
          codeData.Languages[languageName][categoryName].push({
            name,
            description,
            howto,
            url,
            github,
            npm,
            gem,
            sourcePath: markdownFilePath,
          })
        } else if (markdownFilePath.includes("tools")) {
          const toolSupportDirIndex = pathArr.indexOf("tools")
          const toolNameSlugIndex = toolSupportDirIndex + 1
          const toolNameSlug = pathArr[toolNameSlugIndex]
          const toolName = slugMap[toolNameSlug]
          codeData.ToolsNew ||= {}
          codeData.ToolsNew[toolName] ||= {}
          const categoryToolsNameSlugIndex = toolSupportDirIndex + 2
          const categoryToolsNameSlug = pathArr[categoryToolsNameSlugIndex]
          const categoryToolsName = slugMap[categoryToolsNameSlug]
          codeData.ToolsNew[toolName][categoryToolsName] ||= []

          codeData.ToolsNew[toolName][categoryToolsName].push({
            name,
            description,
            howto,
            url,
            github,
            npm,
            gem,
            sourcePath: markdownFilePath,
          })
        } else {
          const codeDirIndex = pathArr.indexOf("code")
          const categoryNameSlugIndex = codeDirIndex + 1
          const categoryNameSlug = pathArr[categoryNameSlugIndex]
          const categoryName = slugMap[categoryNameSlug]
          codeData[categoryName] ||= []
          codeData[categoryName].push({
            name,
            description,
            howto,
            url,
            github,
            npm,
            gem,
            sourcePath: markdownFilePath,
          })
        }
      })
    )
    const languageList: any = []
    const toolList: any = []
    await Promise.all([
      ...Object.keys(codeData.Languages).map(async languageName => {
        const libraryCategoryMap = codeData.Languages[languageName]
        let languageTotalStars = 0
        await Promise.all(
          Object.keys(libraryCategoryMap).map(async libraryCategoryName => {
            const libraries = libraryCategoryMap[libraryCategoryName]
            const { sortedLibs, totalStars } = await sortLibs(libraries)
            libraryCategoryMap[libraryCategoryName] = sortedLibs
            languageTotalStars += totalStars || 0
          })
        )
        languageList.push({
          name: languageName,
          totalStars: languageTotalStars,
          categoryMap: libraryCategoryMap,
        })
      }),
      ...Object.keys(codeData.ToolsNew).map(async toolName => {
        const toolCategoryMap = codeData.ToolsNew[toolName]
        let toolTotalStars = 0
        await Promise.all(
          Object.keys(toolCategoryMap).map(async toolCategoryName => {
            const tools = toolCategoryMap[toolCategoryName]
            const { sortedLibs, totalStars } = await sortLibs(tools)
            toolCategoryMap[toolCategoryName] = sortedLibs
            toolTotalStars += totalStars || 0
          })
        )
        toolList.push({
          name: toolName,
          totalStars: toolTotalStars,
          categoryMap: toolCategoryMap,
        })
      }),
    ])

    context = {
      ...context,
      otherLibraries: {
        Services: codeData.Services,
        "More Stuff": codeData["More Stuff"],
      },
      languageList: languageList.sort((a, b) => {
        if (a.totalStars > b.totalStars) {
          return -1
        }
        if (a.totalStars < b.totalStars) {
          return 1
        }
        return 0
      }),
      toolList: toolList.sort((a, b) => {
        if (a.totalStars > b.totalStars) {
          return -1
        }
        if (a.totalStars < b.totalStars) {
          return 1
        }
        return 0
      }),
    }
  }
  createPage({
    ...page,
    context,
  })
}

export const createPages: GatsbyNode["createPages"] = async ({
  actions,
  graphql,
}) => {
  const { createPage } = actions

  const result = await graphql(`
    query allMarkdownRemark {
      allMarkdownRemark {
        edges {
          node {
            fileAbsolutePath
            parent {
              ... on File {
                relativeDirectory
                sourceInstanceName
              }
            }
            frontmatter {
              title
              permalink
              next
              category
              sublinks
              sidebarTitle
              date
              tags
            }
            id
          }
        }
      }
      allBlogPost {
        group(field: { tags: SELECT }) {
          fieldValue
        }
      }
    }
  `)

  const docTemplate = path.resolve("./src/templates/doc.tsx")

  if (result.errors) {
    // eslint-disable-next-line no-console
    console.error(result.errors)
    throw result.errors
  }

  const tags = result.data.allBlogPost.group.map(group => group.fieldValue)
  for (const tag of tags) {
    createPage({
      path: `/tags/${tag.toLowerCase()}/`,
      component: path.resolve("./src/templates/{BlogPost.tags}.tsx"),
      context: {
        tag,
      },
    })
  }

  const markdownPages = result.data.allMarkdownRemark.edges

  // foundation: [
  //   {
  //     fileAbsolutePath: '/graphql/graphql.github.io/src/content/foundation/About.md',
  //     parent: {},
  //     frontmatter: {},
  //     id: '1d502d5e-3453-56cf-ad9a-7f6bfb68d9ba'
  //   },
  //   ...
  //   ]
  // }
  let pagesGroupedByFolder = {}

  // {
  //   foundation: [
  //     { name: 'foundation', links: [{"fileAbsolutePath":"/graphql/graphql.github.io/src/content/foundation/About.md","parent":{"relativeDirectory":"foundation","sourceInstanceName":"content"},"frontmatter":{"title":"What is the GraphQL Foundation?","permalink":"/foundation/","next":"/foundation/join/","category":"GraphQL Foundation","sublinks":null,"sidebarTitle":"About the Foundation","date":null},"id":"1d502d5e-3453-56cf-ad9a-7f6bfb68d9ba"}] },
  //     { name: 'GraphQL Foundation', links: [Array] }
  //   ],
  // Note that this is mutated
  let sideBardata = {}

  // Sidebar items to add which don't come from markdown
  const additionalSidebarItems = {
    foundation: [
      {
        name: "GraphQL Foundation",
        links: [
          {
            frontmatter: {
              sidebarTitle: "Foundation Members",
              title: "Foundation Members",
              permalink: "/foundation/members/",
              date: null,
              category: "GraphQL Foundation",
            },
          },
          {
            frontmatter: {
              sidebarTitle: "GraphQL Landscape",
              title: "GraphQL Landscape",
              permalink: "https://landscape.graphql.org/",
              date: null,
              category: "GraphQL Foundation",
            },
          },
        ],
      },
    ],
  }

  // E.g.
  // {
  //   permalink: '/learn/best-practices/',
  //   relativeDirectory: 'learn',
  //   sidebarTitle: 'Introduction',
  //   nextPermalink: '/learn/thinking-in-graphs/',
  //   sourcePath: 'src/content/learn/BestPractice-Introduction.md'
  // }
  const allPages = []

  // Loop through all *.md files in the repo, setting up both pagesGroupedByFolder
  // and allPages.
  markdownPages.map(({ node }) => {
    const {
      frontmatter: { permalink, next, sidebarTitle },
      parent: { relativeDirectory, sourceInstanceName },
    } = node

    if (
      sourceInstanceName !== "content" ||
      relativeDirectory.includes("code/")
    ) {
      return
    }

    pagesGroupedByFolder = {
      ...pagesGroupedByFolder,
      [relativeDirectory]: pagesGroupedByFolder[relativeDirectory]
        ? [...pagesGroupedByFolder[relativeDirectory], node]
        : [node],
    }

    allPages.push({
      permalink,
      relativeDirectory,
      sidebarTitle,
      nextPermalink: next,
      sourcePath: path.relative(__dirname, node.fileAbsolutePath),
    })
  })

  // Loop through the sections in the sidebar, mutating the
  // next and previous objects for different
  Object.entries(pagesGroupedByFolder).map(([folder, pages]) => {
    let pagesByUrl = {}
    let previousPagesMap = {}
    let pagesByDate = pages.sort((a, b) => {
      const aDate = new Date(a.frontmatter.date || Date.now())
      const bDate = new Date(b.frontmatter.date || Date.now())
      if (aDate > bDate) {
        return -1
      }
      if (aDate < bDate) {
        return 1
      }
      return 0
    })

    pagesByDate.forEach(page => {
      const next = page.frontmatter.next
      const permalink = page.frontmatter.permalink

      if (next) {
        previousPagesMap[next] = permalink
      }
      pagesByUrl[permalink] = page
    })

    let firstPage = null
    pagesByDate.forEach(page => {
      const permalink = page.frontmatter.permalink
      if (!previousPagesMap[permalink] && !firstPage) {
        firstPage = page
      }
    })

    if (!firstPage) {
      throw new Error(`First page not found in ${folder}`)
    }

    let categoriesMap = {}
    let currentCategory = null

    let page = firstPage
    let i = 0
    while (page && i++ < 1000) {
      const { frontmatter } = page
      const { category: definedCategory, next: definedNextPageUrl } =
        frontmatter
      let category = definedCategory || folder
      if (!currentCategory || category !== currentCategory.name) {
        if (currentCategory) {
          if (!(currentCategory.name in categoriesMap)) {
            categoriesMap[currentCategory.name] = currentCategory
          }
        }
        currentCategory = {
          name: category,
          links: [],
        }
      }
      currentCategory.links.push(page)
      if (definedNextPageUrl) {
        page = pagesByUrl[definedNextPageUrl]
      } else {
        page = pagesByDate[pagesByDate.indexOf(page) + 1]
      }
      if (currentCategory.links.includes(page)) {
        page = null
      }
    }

    if (!(currentCategory.name in categoriesMap)) {
      categoriesMap[currentCategory.name] = currentCategory
    }

    sideBardata[folder] = Object.values(categoriesMap)
  })

  Object.entries(additionalSidebarItems).map(([folder, sections]) => {
    sections.forEach(s => {
      const originalLinks = sideBardata[folder].find(l => l.name === s.name)
      originalLinks.links = [...originalLinks.links, ...s.links]
    })
  })

  // Use all the set up data to now tell Gatsby to create pages
  // on the site
  for (const page of allPages) {
    if (!page.permalink.startsWith("/blog")) {
      createPage({
        path: `${page.permalink}`,
        component: docTemplate,
        context: {
          permalink: page.permalink,
          nextPermalink: page.nextPermalink,
          sideBarData: sideBardata[page.relativeDirectory],
          sourcePath: page.sourcePath,
        },
      })
    }
  }
}

export const onCreateWebpackConfig: GatsbyNode["onCreateWebpackConfig"] =
  async ({ actions }) => {
    actions.setWebpackConfig({
      resolve: {
        fallback: {
          assert: "assert/",
        },
      },
    })
  }
